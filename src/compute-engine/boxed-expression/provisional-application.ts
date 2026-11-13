/**
 * Provenance for a juxtaposition that was read as MULTIPLICATION only because
 * its leading symbol had no function definition *yet*.
 *
 * `2a(t)` is genuinely ambiguous: it is a product when `a` is a scalar and an
 * application when `a` is a function. `canonicalInvisibleOperator` decides with
 * the only evidence it has — whether `a` currently has an operator (or
 * function-typed) definition — and a fresh parse therefore gives the right
 * answer once `a` is defined. A `Function` LITERAL, though, freezes its body at
 * canonicalization time, so `g(t) := 2a(t)` written BEFORE `a(t) := …` kept the
 * product reading forever: definition order changed semantics.
 *
 * The repair is order-independence by re-derivation. While a literal's body is
 * canonicalized, every provisional reading notes its head symbol
 * (`noteProvisionalApplication`); the literal then remembers its RAW operands
 * together with those names (`setProvisionalLiteral`), and any operator
 * definition built from it registers as a dependent of each name
 * (`registerProvisionalDependents`). When one of those names later gains an
 * operator definition, `updateDef` calls `repairProvisionalDependents`, which
 * re-canonicalizes the raw operands in the literal's defining scope and
 * re-installs the result.
 *
 * Re-deriving from the RAW operands — rather than rewriting the frozen body —
 * is what makes the repair robust: the provisional product is routinely folded
 * away by later canonicalization (`a(t) + a(2t)` collapses to `3at`), so there
 * is no node left to rewrite.
 *
 * A second provenance kind shares this registry: a FORWARD-REFERENCED CALL
 * (`noteProvisionalCall`, from `box.ts`). `process(cs) := clean(cs) + 1`
 * written before `clean` exists canonicalizes the application blind, so the
 * collection evidence `clean`'s parameters would have narrowed onto `cs`
 * (`narrowArgsFromInferredSignature`) is lost and `process` broadcasts over a
 * list argument. Both kinds mean the same thing to the repair: *re-derive this
 * literal when `name`'s definition state changes* — when it becomes callable,
 * or when its inferred signature is superseded by a real one.
 *
 * This module holds only registries and the hook: the repair itself needs
 * `canonicalFunctionLiteralArguments` (`function-utils.ts`), which
 * `boxed-expression/utils.ts` cannot import (`utils.ts →
 * boxed-operator-definition.ts → function-utils.ts`), so it is injected by
 * `init-lazy-refs.ts`.
 */

import type {
  BoxedOperatorDefinition,
  BoxedValueDefinition,
  Expression,
  IComputeEngine,
  Scope,
} from '../global-types.js';
import { activeRollbackFrame } from '../inference-rollback.js';

/** A definition waiting on a symbol. An operator definition built from a
 * `Function` literal, or a VALUE definition holding one: a function-typed
 * value definition is read as an application by
 * `canonicalInvisibleOperator` too, so it is exactly as order-dependent. */
export type ProvisionalDependent =
  BoxedOperatorDefinition | BoxedValueDefinition;

/** What a `Function` literal needs to be re-derived: the raw operands it was
 * canonicalized from, the scope it was canonicalized in, and the symbols whose
 * juxtaposition reading was provisional. */
export type ProvisionalLiteral = {
  ops: ReadonlyArray<Expression>;
  heads: ReadonlySet<string>;
  scope: Scope | undefined;
};

//
// 1/ Collecting provisional readings while a body is canonicalized
//

/** What the canonicalization of one `Function` literal body noted. */
export type ProvisionalCapture = {
  heads?: Set<string>;
};

// A frame stays `undefined` until something is actually noted in it: every
// `Function` literal opens one, and a provisional reading is rare.
const FRAMES: (ProvisionalCapture | undefined)[] = [];

/** Start collecting the provisional readings made from here on. Must be paired
 * with `endProvisionalCapture()` in a `finally`. */
export function beginProvisionalCapture(): void {
  FRAMES.push(undefined);
}

/** Stop collecting and return what was collected, or `undefined`. The names
 * also flow up to the enclosing frame, if any: a nested literal's provisional
 * reading is part of the enclosing literal's body, and re-deriving the outer
 * literal re-derives the inner one. */
export function endProvisionalCapture(): ProvisionalCapture | undefined {
  const frame = FRAMES.pop();
  const depth = FRAMES.length;
  if (frame !== undefined && depth > 0) {
    const parent = (FRAMES[depth - 1] ??= {});
    // A copy, never the sets of the frame: they are retained by the literal
    // being built and must not grow with the enclosing body.
    if (frame.heads !== undefined) {
      parent.heads ??= new Set();
      for (const name of frame.heads) parent.heads.add(name);
    }
  }
  return frame;
}

/** True when a `Function` literal body is being canonicalized, so a note would
 * actually be collected. A hot-path guard for callers that would otherwise
 * compute the inputs of a noting call that is a no-op. */
export function isProvisionalCaptureOpen(): boolean {
  return FRAMES.length > 0;
}

/** Record that `name` was read as a multiplication operand where an
 * application was also possible. */
export function noteProvisionalApplication(name: string): void {
  const depth = FRAMES.length;
  if (depth === 0) return;
  ((FRAMES[depth - 1] ??= {}).heads ??= new Set()).add(name);
}

/** Record that `name` was APPLIED while it had no definition (or only a
 * guessed one), so the argument-narrowing side-channel had nothing to read.
 * The same registry and the same repair as `noteProvisionalApplication`: the
 * two differ only in provenance. Idempotent per frame, so a callee reached
 * through both channels in one body is recorded once. A no-op outside a
 * `Function` literal body — a top-level expression re-canonicalizes naturally
 * and needs no repair. */
export function noteProvisionalCall(name: string): void {
  noteProvisionalApplication(name);
}

//
// 2/ The literals that carry a provisional reading, and the definitions
//    built from them
//

const LITERALS = new WeakMap<object, ProvisionalLiteral>();

export function setProvisionalLiteral(
  literal: object,
  info: ProvisionalLiteral
): void {
  LITERALS.set(literal, info);
}

export function provisionalLiteral(
  literal: object | undefined
): ProvisionalLiteral | undefined {
  return literal === undefined ? undefined : LITERALS.get(literal);
}

/** The definitions waiting on one name, as WEAK references.
 *
 * The registry holds a definition only weakly: a definition that nothing
 * else reaches (its scope was popped and discarded, or a redefinition
 * replaced it) is collected with its literal and raw operands, and its
 * reference is removed from here at the next read of the name, or at the
 * next sweep. Before, the registry held each definition strongly for the
 * life of the engine, so a host that pushed a scope, defined functions whose
 * bodies applied undeclared names, and popped the scope, kept every one of
 * those definitions, and each later declaration of such a name walked them
 * all (CE-1102). A definition that something still reaches, for example one
 * in a popped scope that the host keeps and pushes again later, stays
 * registered and is re-derived as before: the registry makes no assumption
 * about the life of a scope.
 *
 * Two consequences of weak references. (1) `hasProvisionalDependents()`, which
 * `withValues()` reads to refuse a value for a name that a stored body
 * applies, answers false for a name that only collected bodies applied: the
 * refusal depends on when the collector ran. (2) A `WeakRef` keeps its target
 * alive until the end of the current job (ECMAScript `AddToKeptObjects`, in
 * the constructor and in `deref()`), so the definitions of a scope that is
 * pushed and popped many times in one synchronous job are released only when
 * that job ends; a test must yield to the event loop before it collects. */
type Waiting = {
  refs: Set<WeakRef<ProvisionalDependent>>;
  /** The size of `refs` at which the next sweep of collected references
   * runs: twice the number of live references after the last sweep, at
   * least `SWEEP_MIN`. The sweep bounds the registry to about twice its live
   * size for a name that is never read: an undeclared name that a host
   * applies in each edit and never declares. */
  sweepAt: number;
};

const SWEEP_MIN = 16;

function newWaiting(): Waiting {
  return { refs: new Set(), sweepAt: SWEEP_MIN };
}

/** Remove from `waiting` the references whose definition was collected, and
 * set the size at which the next sweep runs. */
function sweep(waiting: Waiting): void {
  for (const ref of waiting.refs)
    if (ref.deref() === undefined) waiting.refs.delete(ref);
  waiting.sweepAt = Math.max(SWEEP_MIN, 2 * waiting.refs.size);
}

/** The definitions in `waiting` that are still in memory, each with its
 * reference, in the order of their registration. The references whose
 * definition was collected are removed from `waiting`. */
function liveDependents(
  waiting: Waiting
): { ref: WeakRef<ProvisionalDependent>; def: ProvisionalDependent }[] {
  const live: {
    ref: WeakRef<ProvisionalDependent>;
    def: ProvisionalDependent;
  }[] = [];
  for (const ref of waiting.refs) {
    const def = ref.deref();
    if (def === undefined) waiting.refs.delete(ref);
    else live.push({ ref, def });
  }
  return live;
}

const DEPENDENTS = new WeakMap<object, Map<string, Waiting>>();

/** The reverse of `DEPENDENTS`: the names each registered definition waits on,
 * and the ONE weak reference through which every set of `DEPENDENTS` holds the
 * definition, so that membership is tested and removed by the identity of
 * that reference. A definition object is SUPERSEDED on every redefinition
 * (`updateDef` builds a fresh one for each `f(t) := …`), and without this
 * index the superseded object stayed in every set it had joined, and a
 * later repair of the name re-derived the orphan instead of the installed
 * definition. */
type Registration = {
  ce: IComputeEngine;
  names: Set<string>;
  ref: WeakRef<ProvisionalDependent>;
};

const REGISTRATIONS = new WeakMap<object, Registration>();

/**
 * Rollback journal (family 5, the forward-reference registry): every
 * mutator of `DEPENDENTS`/`REGISTRATIONS` — `registerProvisionalDependents`,
 * `unregisterProvisionalDependent`, `takeProvisionalDependents` — journals a
 * delta undo while a rollback frame is open, with prior-presence bits, so
 * membership AND the `REGISTRATIONS` reverse-index metadata restore
 * index-consistently. This replaced the snapshot-based
 * `provisionalRegistryRollbackPoint` (deleted in phase 2b of
 * `docs/TYPE-SYSTEM.md`), whose one restore
 * re-installed the snapshot's own `Set` objects — so a second rollback of
 * the same point restored already-mutated state. Undo actions manipulate
 * the module maps directly (never through the hooked functions), so a
 * rollback is never re-journaled into an enclosing frame.
 */

/** Register `def` to be re-derived when one of the symbols its body read
 * provisionally gains an operator definition. A no-op for a literal with no
 * provisional reading (the overwhelmingly common case). */
export function registerProvisionalDependents(
  ce: IComputeEngine,
  literal: object | undefined,
  def: ProvisionalDependent
): void {
  const info = literal === undefined ? undefined : LITERALS.get(literal);
  if (info === undefined) return;
  let byName = DEPENDENTS.get(ce);
  if (byName === undefined) {
    byName = new Map();
    DEPENDENTS.set(ce, byName);
  }

  const frame = activeRollbackFrame(ce);
  const priorRegistration = REGISTRATIONS.get(def);

  let registration = priorRegistration;
  if (registration === undefined || registration.ce !== ce) {
    registration = { ce, names: new Set(), ref: new WeakRef(def) };
    REGISTRATIONS.set(def, registration);
  }
  const ref = registration.ref;

  // Delta record for the rollback journal: only what THIS call added is
  // removed by the undo — prior membership (`def` already waiting on a
  // name, a name already in the reverse index) is pre-frame evidence and
  // must survive.
  // Membership deltas are collected only when something will journal them.
  const journaling = frame !== undefined;
  const addedToDependents: string[] = [];
  const addedToReverseIndex: string[] = [];
  for (const name of info.heads) {
    let waiting = byName.get(name);
    if (waiting === undefined) {
      waiting = newWaiting();
      byName.set(name, waiting);
    }
    if (journaling && !waiting.refs.has(ref)) addedToDependents.push(name);
    waiting.refs.add(ref);
    // The sweep runs here, and not only when a name is read, because an
    // undeclared name that no declaration ever reads is otherwise never
    // read.
    if (waiting.refs.size >= waiting.sweepAt) sweep(waiting);
    if (journaling && !registration.names.has(name))
      addedToReverseIndex.push(name);
    registration.names.add(name);
  }

  if (frame !== undefined) {
    const installedRegistration = registration;
    const dependentsForEngine = byName;
    const undo = (): void => {
      for (const name of addedToDependents) {
        const waiting = dependentsForEngine.get(name);
        if (waiting === undefined) continue;
        waiting.refs.delete(ref);
        if (waiting.refs.size === 0) dependentsForEngine.delete(name);
      }
      for (const name of addedToReverseIndex)
        installedRegistration.names.delete(name);
      if (installedRegistration !== priorRegistration) {
        // The undo reads the definition through the weak reference: no
        // entry of this registry holds a definition, so none of them
        // decides what stays in memory. A collected definition has no index
        // entry to restore.
        const target = ref.deref();
        if (target === undefined) return;
        if (priorRegistration === undefined) REGISTRATIONS.delete(target);
        else REGISTRATIONS.set(target, priorRegistration);
      }
    };
    frame?.record({ undo });
  }
}

/** Drop a definition object that is no longer installed from every set it
 * joined. Called by `updateDef` for the record's superseded halves: a
 * superseded definition can stay in memory (a symbol caches the definition
 * it resolved to), and a definition that can never be consulted again must
 * not be re-derived in place of the installed one. */
export function unregisterProvisionalDependent(def: object | undefined): void {
  if (def === undefined) return;
  const registration = REGISTRATIONS.get(def);
  if (registration === undefined) return;
  REGISTRATIONS.delete(def);
  const frame = activeRollbackFrame(registration.ce);
  const byName = DEPENDENTS.get(registration.ce);
  // Names whose dependents set actually held `def` — the delta the rollback
  // journal re-adds. The `registration` object itself is untouched (only
  // its index entry is deleted), so the undo restores it by identity.
  const removedFrom: string[] = [];
  if (byName !== undefined) {
    for (const name of registration.names) {
      const waiting = byName.get(name);
      if (waiting === undefined) continue;
      if (
        waiting.refs.delete(registration.ref) &&
        frame !== undefined
      )
        removedFrom.push(name);
      if (waiting.refs.size === 0) byName.delete(name);
    }
  }
  if (frame !== undefined) {
    const undo = (): void => {
      // The undo reads the definition through the weak reference, as the
      // other entries of this registry do. The references go back into the
      // sets even for a collected definition: the next read of the name
      // removes them.
      const target = registration.ref.deref();
      if (target !== undefined) REGISTRATIONS.set(target, registration);
      if (byName === undefined) return;
      for (const name of removedFrom) {
        let waiting = byName.get(name);
        if (waiting === undefined) {
          waiting = newWaiting();
          byName.set(name, waiting);
        }
        waiting.refs.add(registration.ref);
      }
    };
    frame?.record({ undo });
  }
}

/**
 * How many definitions are currently waiting on `name` in this engine's
 * forward-reference registry. **Test-only**: the registry is otherwise
 * observable only through `takeProvisionalDependents`, which REMOVES what it
 * reports, so there is no non-destructive way for a test to check that a
 * rollback put the membership back.
 * @internal
 */
export function _provisionalDependentCount(
  ce: IComputeEngine,
  name: string
): number {
  const byName = DEPENDENTS.get(ce);
  const waiting = byName?.get(name);
  if (waiting === undefined) return 0;
  const count = liveDependents(waiting).length;
  if (count === 0) byName!.delete(name);
  return count;
}

/**
 * How many references the registry holds under `name`, collected or not.
 * **Test-only**, for the sweep: `_provisionalDependentCount` removes the
 * references whose definition was collected, so it cannot show whether a
 * registration swept them.
 * @internal
 */
export function _provisionalReferenceCount(
  ce: IComputeEngine,
  name: string
): number {
  return DEPENDENTS.get(ce)?.get(name)?.refs.size ?? 0;
}

/** Is at least one definition waiting on `name` in this engine? A
 * definition that was collected does not count, and its reference is
 * removed. */
export function hasProvisionalDependents(
  ce: IComputeEngine,
  name: string
): boolean {
  const byName = DEPENDENTS.get(ce);
  const waiting = byName?.get(name);
  if (waiting === undefined) return false;
  for (const ref of waiting.refs) {
    if (ref.deref() !== undefined) return true;
    waiting.refs.delete(ref);
  }
  byName!.delete(name);
  return false;
}

/** Remove from the registry the definitions waiting on `name` and return
 * them. With `select`, only the definitions it accepts are removed and
 * returned; the others stay registered under `name`. A definition that was
 * collected is neither returned nor kept. */
export function takeProvisionalDependents(
  ce: IComputeEngine,
  name: string,
  select?: (def: ProvisionalDependent) => boolean
): ProvisionalDependent[] | undefined {
  const byName = DEPENDENTS.get(ce);
  const waiting = byName?.get(name);
  if (waiting === undefined) return undefined;
  const live = liveDependents(waiting);
  if (live.length === 0) {
    byName!.delete(name);
    return undefined;
  }
  const taken =
    select === undefined ? live : live.filter((entry) => select(entry.def));
  if (taken.length === 0) return undefined;
  if (taken.length === live.length) byName!.delete(name);
  else for (const entry of taken) waiting.refs.delete(entry.ref);
  const frame = activeRollbackFrame(ce);
  // Reverse-index entries this take actually removed `name` from, captured
  // by identity for the rollback journal.
  const strippedRegistrations: { names: Set<string> }[] = [];
  for (const entry of taken) {
    const registration = REGISTRATIONS.get(entry.def);
    if (registration === undefined) continue;
    if (
      registration.names.delete(name) &&
      frame !== undefined
    )
      strippedRegistrations.push(registration);
  }
  if (frame !== undefined) {
    // The undo holds the weak references, not the definitions: a journal
    // entry must not keep a definition that nothing else reaches.
    const takenRefs = taken.map((entry) => entry.ref);
    const undo = (): void => {
      // MERGED back into whatever set is currently under `name`, never
      // installed over it. The strict-LIFO unwind of the frame has already
      // removed every later registration, so the current set is empty or
      // absent when this runs.
      let current = byName!.get(name);
      if (current === undefined) {
        current = newWaiting();
        byName!.set(name, current);
      }
      for (const ref of takenRefs) current.refs.add(ref);
      for (const registration of strippedRegistrations)
        registration.names.add(name);
    };
    frame?.record({ undo });
  }
  return taken.map((entry) => entry.def);
}

/** The scope that holds the binding of `name` that `holds` accepts: the first
 * such scope from `start` through its ancestors, or `undefined` when no scope
 * of that chain holds it.
 *
 * A caller of `repairProvisionalDependents()` that was not given the scope of
 * the binding it installed uses this to find it, so that the repair
 * re-derives only the definitions that can see the binding. `holds` tests
 * the identity of the binding record or of one of its halves, never the name
 * alone: another binding of the same name on the chain is a different
 * binding, and its scope would exclude definitions that the repair must
 * re-derive. */
export function scopeOfBinding(
  start: Scope | null | undefined,
  name: string,
  holds: (binding: {
    value?: BoxedValueDefinition;
    operator?: BoxedOperatorDefinition;
  }) => boolean
): Scope | undefined {
  for (let scope = start; scope; scope = scope.parent) {
    const binding = scope.bindings.get(name);
    if (binding !== undefined && holds(binding)) return scope;
  }
  return undefined;
}

//
// 3/ The repair hook
//

type RepairFn = (
  ce: IComputeEngine,
  name: string,
  justInstalled?: ProvisionalDependent,
  declaredIn?: Scope,
  boundIn?: Scope
) => void;

let _repair: RepairFn | undefined;

export function _setProvisionalRepair(fn: RepairFn): void {
  _repair = fn;
}

/** `name` just gained an operator definition: re-derive every definition whose
 * body read it provisionally.
 *
 * `justInstalled` is the definition the caller has just installed for `name`,
 * when there is one. A RECURSIVE body notes its own name (the self-call sees
 * no definition yet), so without this the freshly built definition would
 * re-derive itself on install — a full re-canonicalization that can learn
 * nothing, since self-call narrowing is circular by construction. */
export function repairProvisionalDependents(
  ce: IComputeEngine,
  name: string,
  justInstalled?: ProvisionalDependent,
  declaredIn?: Scope,
  boundIn?: Scope
): void {
  if (!hasProvisionalDependents(ce, name)) return;
  // `declaredIn` is the scope that now holds the new binding of `name`, when
  // the caller knows it. A waiting literal resolves `name` from the scope it
  // was canonicalized in, through that scope's ancestors. The repair
  // re-derives only the waiting definitions whose literal has `declaredIn` on
  // that chain, and leaves the others registered: for them `name` resolves as
  // before, so there is nothing to repair yet. Without this, every `Function`
  // literal that APPLIES an undeclared name, which declares that name in the
  // literal's own new scope, re-derived every definition waiting on the same
  // name, and each re-derivation declared the name again in a new scope of
  // its own. Deriving the signature of a function declared `-> unknown` boxes
  // its body in a new scope too, so typing nested calls of such functions
  // replaced their stored literals over and over, invalidated each other's
  // memoized signatures, and took exponential time in the nesting depth
  // (Tycho item 336, `test/compute-engine/tycho-item-336-nested-signature-derivation.test.ts`).
  // A declaration in a scope on a waiting literal's chain (the global scope,
  // or the scope a definition was made in) still repairs that definition.
  //
  // `boundIn` is for a caller that installed a definition in an existing
  // binding and found the scope of that binding itself (`scopeOfBinding()`).
  // Such a binding can be a local that a `Function` literal assigns in its
  // own body when it runs, in a scope UNDER the scope the literal was
  // canonicalized in, and the literal waits on it. So the repair re-derives
  // the waiting definitions whose literal has `boundIn` on its chain, as for
  // `declaredIn`, and also those whose literal was canonicalized in a scope
  // that `boundIn` has on its own chain. It leaves the definitions of a
  // scope that is neither above nor under `boundIn`: for them `name`
  // resolves as before. Two scope objects that stand for one lexical level
  // (a scope and the copy or the run of it that an evaluation makes) count
  // as one scope in this test (`sameLexicalLevel()`, `function-utils.ts`),
  // and a definition is re-derived too when a scope of its chain holds the
  // same binding as `boundIn` (`ce.createScope()` installs one definition in
  // two scopes).
  // The test reads the parent links as they are at the repair: a scope that
  // is chained under another scope only while a frame lives
  // (`pushEvalContext()` with `ambient`, `engine-scope.ts`) is not under
  // that scope for this test, as for `declaredIn`.
  //
  // This keeps the repair away from the definitions of a scope that the
  // host popped and discarded. The registry holds them, through weak
  // references, until the collector frees them, and a host that pops and
  // pushes a scope at each edit of a document declares the same names again
  // in each new scope. A repair with neither scope re-derived the
  // definitions of every earlier scope at each of those declarations, so
  // each edit took longer than the one before until a full collection ran
  // (`issues/CE-1102.md`). With neither scope, the repair re-derives every
  // waiting definition.
  _repair?.(ce, name, justInstalled, declaredIn, boundIn);
}
