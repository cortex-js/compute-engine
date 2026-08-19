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
  | BoxedOperatorDefinition
  | BoxedValueDefinition;

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

// A frame stays `undefined` until something is actually noted in it: every
// `Function` literal opens one, and a provisional reading is rare.
const FRAMES: (Set<string> | undefined)[] = [];

/** Start collecting the provisional readings made from here on. Must be paired
 * with `endProvisionalCapture()` in a `finally`. */
export function beginProvisionalCapture(): void {
  FRAMES.push(undefined);
}

/** Stop collecting and return what was collected, or `undefined`. The names
 * also flow up to the enclosing frame, if any: a nested literal's provisional
 * reading is part of the enclosing literal's body, and re-deriving the outer
 * literal re-derives the inner one. */
export function endProvisionalCapture(): ReadonlySet<string> | undefined {
  const frame = FRAMES.pop();
  const depth = FRAMES.length;
  if (frame !== undefined && depth > 0) {
    const parent = FRAMES[depth - 1];
    // A copy, never the frame itself: the returned set is retained by the
    // literal being built and must not grow with the enclosing body.
    if (parent === undefined) FRAMES[depth - 1] = new Set(frame);
    else for (const name of frame) parent.add(name);
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
  (FRAMES[depth - 1] ??= new Set()).add(name);
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

const DEPENDENTS = new WeakMap<
  object,
  Map<string, Set<ProvisionalDependent>>
>();

/** The reverse of `DEPENDENTS`: the names each registered definition waits on.
 * A definition object is SUPERSEDED on every redefinition (`updateDef` builds a
 * fresh one for each `f(t) := …`), and without this index the superseded object
 * stayed in every set it had joined — one orphan, holding its literal and raw
 * operands, per reassignment. */
const REGISTRATIONS = new WeakMap<
  object,
  { ce: IComputeEngine; names: Set<string> }
>();

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
 *
 * The CHECKPOINT journal (`checkpoint-journal.ts`) extends the same three
 * hooks: the registry holds STRONG references to definition halves, so a
 * restore that rewinds a redefinition without rewinding these deltas leaves
 * the reinstated half unregistered while the orphaned replacement stays in
 * every dependents set it joined — later forward-reference fulfillment then
 * repairs the orphan instead of the installed definition, and the orphan
 * never becomes collectable. Recorded with `recordDelta`, NOT with the
 * window's usual (owner, key) entries: each of these undos removes exactly
 * what ITS call added, so first-write-wins dedup would drop every later
 * call's delta and leave it applied.
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
  const window = ce._checkpointWindow;
  const priorRegistration = REGISTRATIONS.get(def);

  let registration = priorRegistration;
  if (registration === undefined || registration.ce !== ce) {
    registration = { ce, names: new Set() };
    REGISTRATIONS.set(def, registration);
  }

  // Delta record for the rollback journal: only what THIS call added is
  // removed by the undo — prior membership (`def` already waiting on a
  // name, a name already in the reverse index) is pre-frame evidence and
  // must survive.
  // Membership deltas are collected only when something will journal them.
  const journaling = frame !== undefined || window !== undefined;
  const addedToDependents: string[] = [];
  const addedToReverseIndex: string[] = [];
  for (const name of info.heads) {
    let defs = byName.get(name);
    if (defs === undefined) {
      defs = new Set();
      byName.set(name, defs);
    }
    if (journaling && !defs.has(def)) addedToDependents.push(name);
    defs.add(def);
    if (journaling && !registration.names.has(name))
      addedToReverseIndex.push(name);
    registration.names.add(name);
  }

  if (frame !== undefined || window !== undefined) {
    const installedRegistration = registration;
    const dependentsForEngine = byName;
    const undo = (): void => {
      for (const name of addedToDependents) {
        const defs = dependentsForEngine.get(name);
        if (defs === undefined) continue;
        defs.delete(def);
        if (defs.size === 0) dependentsForEngine.delete(name);
      }
      for (const name of addedToReverseIndex)
        installedRegistration.names.delete(name);
      if (installedRegistration !== priorRegistration) {
        if (priorRegistration === undefined) REGISTRATIONS.delete(def);
        else REGISTRATIONS.set(def, priorRegistration);
      }
    };
    frame?.record({ undo });
    window?.recordDelta(undo);
  }
}

/** Drop a definition object that is no longer installed from every set it
 * joined. Called by `updateDef` for the record's superseded halves: the
 * registry holds STRONG references, so a definition that can never be
 * consulted again must not stay in it. */
export function unregisterProvisionalDependent(def: object | undefined): void {
  if (def === undefined) return;
  const registration = REGISTRATIONS.get(def);
  if (registration === undefined) return;
  REGISTRATIONS.delete(def);
  const frame = activeRollbackFrame(registration.ce);
  const window = registration.ce._checkpointWindow;
  const byName = DEPENDENTS.get(registration.ce);
  // Names whose dependents set actually held `def` — the delta the rollback
  // journal re-adds. The `registration` object itself is untouched (only
  // its index entry is deleted), so the undo restores it by identity.
  const removedFrom: string[] = [];
  if (byName !== undefined) {
    for (const name of registration.names) {
      const defs = byName.get(name);
      if (defs === undefined) continue;
      if (
        defs.delete(def as ProvisionalDependent) &&
        (frame !== undefined || window !== undefined)
      )
        removedFrom.push(name);
      if (defs.size === 0) byName.delete(name);
    }
  }
  if (frame !== undefined || window !== undefined) {
    const undo = (): void => {
      REGISTRATIONS.set(def, registration);
      if (byName === undefined) return;
      for (const name of removedFrom) {
        let defs = byName.get(name);
        if (defs === undefined) {
          defs = new Set();
          byName.set(name, defs);
        }
        defs.add(def as ProvisionalDependent);
      }
    };
    frame?.record({ undo });
    window?.recordDelta(undo);
  }
}

/** The definitions waiting on `name`, removed from the registry. A repaired
 * definition re-registers itself for whatever names remain provisional. */
/**
 * How many definitions are currently waiting on `name` in this engine's
 * forward-reference registry. **Test-only**: the registry is otherwise
 * observable only through `takeProvisionalDependents`, which REMOVES what it
 * reports, so there is no non-destructive way for a test to check that a
 * checkpoint restore put the membership back.
 * @internal
 */
export function _provisionalDependentCount(
  ce: IComputeEngine,
  name: string
): number {
  return DEPENDENTS.get(ce)?.get(name)?.size ?? 0;
}

export function takeProvisionalDependents(
  ce: IComputeEngine,
  name: string
): ProvisionalDependent[] | undefined {
  const byName = DEPENDENTS.get(ce);
  const defs = byName?.get(name);
  if (defs === undefined) return undefined;
  byName!.delete(name);
  const frame = activeRollbackFrame(ce);
  const window = ce._checkpointWindow;
  // Reverse-index entries this take actually removed `name` from, captured
  // by identity for the rollback journal.
  const strippedRegistrations: { names: Set<string> }[] = [];
  for (const def of defs) {
    const registration = REGISTRATIONS.get(def);
    if (registration === undefined) continue;
    if (
      registration.names.delete(name) &&
      (frame !== undefined || window !== undefined)
    )
      strippedRegistrations.push(registration);
  }
  if (frame !== undefined || window !== undefined) {
    const undo = (): void => {
      // MERGED back into whatever set is currently under `name`, never
      // installed over it. Re-installing the detached set by identity is
      // exact only if nothing else can be under the name when this entry
      // replays — true for an inference frame, whose strict-LIFO unwind has
      // already removed every later re-registration, and NOT true for a
      // checkpoint window: its replay reaches back past takes and
      // registrations that interleaved across a whole cell, so a wholesale
      // install discards membership the entries replayed before this one had
      // just restored. Measured: a symbol applied before it was callable in
      // one cell and again in the next lost its FIRST cell's dependent on
      // restore. A merge is equally exact in the frame case, where the
      // current set is empty or absent by the time it runs.
      let current = byName!.get(name);
      if (current === undefined) {
        current = new Set();
        byName!.set(name, current);
      }
      for (const def of defs) current.add(def);
      for (const registration of strippedRegistrations)
        registration.names.add(name);
    };
    frame?.record({ undo });
    window?.recordDelta(undo);
  }
  return [...defs];
}

//
// 3/ The repair hook
//

type RepairFn = (
  ce: IComputeEngine,
  name: string,
  justInstalled?: ProvisionalDependent
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
  justInstalled?: ProvisionalDependent
): void {
  if (DEPENDENTS.get(ce)?.has(name) !== true) return;
  _repair?.(ce, name, justInstalled);
}
