import { narrow } from '../common/type/utils.js';
import type { Type } from '../common/type/types.js';
import type {
  Expression,
  IComputeEngine as ComputeEngine,
  InferResult,
  Scope,
} from './global-types.js';
import { definitionHome, unitEnvironmentsOf } from './binding-unit.js';
import { BoxedSymbol } from './boxed-expression/boxed-symbol.js';
import { markForwardCallReference } from './boxed-expression/forward-call-reference.js';
import { isOperatorDef, isValueDef } from './boxed-expression/utils.js';
import {
  currentBoxingEpoch,
  recordTypeProvenance,
} from './boxed-expression/type-provenance.js';

/** The requirements on one name in its home scope: `type` is the meet of the
 * type entries, `undefined` when the name has only a reading as a variable
 * (`N` in `N + 1`); `conflict` is true when that meet is `never`. */
type Candidate = {
  name: string;
  scope: Scope;
  type: Type | undefined;
  conflict: boolean;
};

/**
 * `ce.infer(exprs)` (rule 11 of
 * `docs/plans/2026-11-09-binding-units-slice-1-spec.md`): commit the
 * requirements that the units of `exprs` wrote in their environments.
 *
 * - The environments are those of the occurrences of `exprs`, with their
 *   parents (`unitEnvironmentsOf()`).
 * - Each key of an entry is resolved to its home scope first. The key of a
 *   free name is its home scope. The key of a name that had an inferred
 *   definition, or one of type `unknown`, when it was boxed is that
 *   definition: its home scope is the scope that held it when the entry was
 *   written (`definitionHome()`), or else the scope of the current chain
 *   that holds it. A free name and a definition key of the same name in the
 *   same home scope are one candidate.
 * - The requirements are met per (home scope, name). The meet does not
 *   depend on the order of `exprs`. The candidate type is that meet, met
 *   with the type of an inferred definition of the name in its home scope.
 * - The name is declared in its home scope, inferred, or its inferred
 *   definition there is narrowed to the candidate, when the home scope is on
 *   the current chain (else `out-of-scope`), the name has no definition
 *   there that is not inferred (else `defined`), and the candidate is not
 *   `never` (`conflict`) or `unknown` (`untyped`). Otherwise nothing
 *   changes, and the name is reported with the reason. A narrowing that
 *   writes nothing (the definition already has the candidate type) is not
 *   reported.
 *
 * A name read as a variable (`N`) is declared as a variable, which shadows
 * the library operator of that name, and a call head (`f` in `f(x)`) is
 * declared with its function type, as the boxing declared them without the
 * engine flag `_bindingUnits`.
 */
export function inferFn(
  ce: ComputeEngine,
  exprs: ReadonlyArray<Expression>
): InferResult {
  const chain: Scope[] = [];
  for (let s: Scope | null = ce.context.lexicalScope; s; s = s.parent)
    chain.push(s);

  /** The home scope of the key `key` of an entry for `name`.
   * `BoxedSymbol._unitWriteScope()` records the scope of a definition key
   * when the definition is on a chain of the boxing, so the scope is known
   * after it was popped and after the definition was replaced. A definition
   * that was on no chain of the boxing (in a scope already popped when the
   * expression was boxed) has no recorded scope: when no scope of the
   * current chain holds it either, it has no home scope to report, and its
   * entries are left out. */
  const homeOf = (key: object, name: string): Scope | undefined => {
    if (isScope(key)) return key;
    return (
      definitionHome<Scope>(key) ??
      chain.find((s) => {
        const b = s.bindings.get(name);
        return b !== undefined && isValueDef(b) && b.value === key;
      })
    );
  };

  const candidates = new Map<Scope, Map<string, Candidate>>();
  const candidate = (scope: Scope, name: string): Candidate => {
    let names = candidates.get(scope);
    if (names === undefined) candidates.set(scope, (names = new Map()));
    let c = names.get(name);
    if (c === undefined)
      names.set(name, (c = { name, scope, type: undefined, conflict: false }));
    return c;
  };
  for (const env of unitEnvironmentsOf(exprs)) {
    for (const [key, name, entry] of env.entries()) {
      const scope = homeOf(key, name);
      if (scope === undefined) continue;
      const c = candidate(scope, name);
      if (c.conflict) continue;
      if (c.type === undefined) c.type = entry.type;
      else {
        const meet = narrow(c.type, entry.type);
        if (meet === 'never') c.conflict = true;
        else c.type = meet;
      }
    }
    for (const [scope, name] of env.variableReadings())
      candidate(scope as Scope, name);
  }

  /** The depth of a scope: the number of its ancestors. */
  const depth = (scope: Scope): number => {
    let n = 0;
    for (let s = scope.parent; s; s = s.parent) n += 1;
    return n;
  };

  type Row = { name: string; scope: Scope };
  const commits: (Row & { type: Type; narrows: boolean })[] = [];
  const declared: InferResult['declared'][number][] = [];
  const skipped: InferResult['skipped'][number][] = [];

  for (const names of candidates.values())
    for (const c of names.values()) {
      const { name, scope } = c;
      if (!chain.includes(scope)) {
        skipped.push({ name, scope, reason: 'out-of-scope' });
        continue;
      }
      const existing = scope.bindings.get(name);
      if (
        existing !== undefined &&
        !(isValueDef(existing) && existing.value.inferredType)
      ) {
        skipped.push({ name, scope, reason: 'defined' });
        continue;
      }
      if (c.conflict) {
        skipped.push({ name, scope, reason: 'conflict' });
        continue;
      }
      let type: Type = c.type ?? 'unknown';
      if (existing !== undefined && isValueDef(existing))
        type = narrow(existing.value.declaredType.type, type);
      if (type === 'never') {
        skipped.push({ name, scope, reason: 'conflict' });
        continue;
      }
      if (ce.type(type).isUnknown) {
        skipped.push({ name, scope, reason: 'untyped' });
        continue;
      }
      commits.push({ name, scope, type, narrows: existing !== undefined });
    }

  const byNameThenDepth = (a: Row, b: Row): number =>
    a.name < b.name
      ? -1
      : a.name > b.name
        ? 1
        : depth(a.scope) - depth(b.scope);
  commits.sort(byNameThenDepth);
  skipped.sort(byNameThenDepth);

  for (const { name, scope, type, narrows } of commits) {
    if (narrows) {
      // Narrow the inferred definition through a symbol bound to it, as a
      // use of the name narrows it. A narrowing that writes nothing is not
      // reported: `_infer()` is false when it adds no information, and true
      // also for a write of the type the definition already has.
      const binding = scope.bindings.get(name)!;
      const before = isValueDef(binding)
        ? binding.value.declaredType
        : undefined;
      if (before?.is(type) === true) continue;
      const target = new BoxedSymbol(ce, name, { def: binding });
      if (!ce._inScope(scope, () => target._infer(() => type, 'narrow')))
        continue;
    } else {
      const def = ce._declareSymbolValue(name, { type, inferred: true }, scope);
      // The type came from the uses of the name: record it as an inference
      // write, as the narrowing of the declaration that the boxing made
      // without the flag records it, so that an assignment narrows it
      // (`deriveAndWriteAssignedType()`, `engine-declarations.ts`).
      const written = isValueDef(def)
        ? { half: def.value, type: def.value.type }
        : isOperatorDef(def)
          ? { half: def.operator, type: def.operator.signature }
          : undefined;
      if (written !== undefined)
        recordTypeProvenance(ce, written.half, {
          type: written.type,
          kind: 'inferred',
          axis: 'type',
          epoch: currentBoxingEpoch(ce),
        });
      // A call head is a name to resolve when the call is evaluated, as the
      // declaration that the boxing made without the flag
      // (`markForwardCallReference()`, `box.ts`).
      if (ce.type(type).matches('function'))
        markForwardCallReference(def, scope);
    }
    const def = scope.bindings.get(name);
    declared.push({
      name,
      scope,
      type:
        def !== undefined && isValueDef(def)
          ? def.value.declaredType.type
          : type,
    });
  }
  return { declared, skipped };
}

/** True when `key`, a key of a unit environment, is a scope (it has a map of
 * bindings), and not a value definition. */
function isScope(key: object): key is Scope {
  return (key as { bindings?: unknown }).bindings instanceof Map;
}
