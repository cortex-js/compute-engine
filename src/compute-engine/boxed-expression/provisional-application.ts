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

/** Record that `name` was read as a multiplication operand where an
 * application was also possible. */
export function noteProvisionalApplication(name: string): void {
  const depth = FRAMES.length;
  if (depth === 0) return;
  (FRAMES[depth - 1] ??= new Set()).add(name);
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
  let registration = REGISTRATIONS.get(def);
  if (registration === undefined || registration.ce !== ce) {
    registration = { ce, names: new Set() };
    REGISTRATIONS.set(def, registration);
  }
  for (const name of info.heads) {
    let defs = byName.get(name);
    if (defs === undefined) {
      defs = new Set();
      byName.set(name, defs);
    }
    defs.add(def);
    registration.names.add(name);
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
  const byName = DEPENDENTS.get(registration.ce);
  if (byName === undefined) return;
  for (const name of registration.names) {
    const defs = byName.get(name);
    if (defs === undefined) continue;
    defs.delete(def as ProvisionalDependent);
    if (defs.size === 0) byName.delete(name);
  }
}

/** The definitions waiting on `name`, removed from the registry. A repaired
 * definition re-registers itself for whatever names remain provisional. */
export function takeProvisionalDependents(
  ce: IComputeEngine,
  name: string
): ProvisionalDependent[] | undefined {
  const byName = DEPENDENTS.get(ce);
  const defs = byName?.get(name);
  if (defs === undefined) return undefined;
  byName!.delete(name);
  for (const def of defs) REGISTRATIONS.get(def)?.names.delete(name);
  return [...defs];
}

//
// 3/ The repair hook
//

type RepairFn = (ce: IComputeEngine, name: string) => void;

let _repair: RepairFn | undefined;

export function _setProvisionalRepair(fn: RepairFn): void {
  _repair = fn;
}

/** `name` just gained an operator definition: re-derive every definition whose
 * body read it as a multiplication operand. */
export function repairProvisionalDependents(
  ce: IComputeEngine,
  name: string
): void {
  if (DEPENDENTS.get(ce)?.has(name) !== true) return;
  _repair?.(ce, name);
}
