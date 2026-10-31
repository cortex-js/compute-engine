// Fresh names: temporaries, naming contexts, and the bound-scope helpers.

import type { Expression } from '../global-types.js';
import { recordScopeParent } from './javascript-value-facts.js';
import { resetJavaScriptStatements } from './javascript-statements.js';
import { nonNegativeRangeType } from '../../common/type/utils.js';
import type { CompileTarget, NamingContext } from './types.js';
import { collectUsedNames } from './compiler-names.js';

/** `real<0..>`: every real number that is not negative. */
export const NON_NEGATIVE_REAL_TYPE = nonNegativeRangeType('real');

/** Bind names while removing contracts belonging to their outer bindings. */
export function withBoundScope(
  target: CompileTarget<Expression>,
  names: ReadonlyArray<string>
): Pick<
  CompileTarget<Expression>,
  | 'boundVars'
  | 'declaredVarTypes'
  | 'localFunctions'
  | 'lexicalFunctions'
  | 'reboundFunctions'
> {
  // A binder replaces the binding, its contract, and its callable provenance.
  // Keep captured names; callers can then install their new local facts.
  const without = <T>(entries: ReadonlyMap<string, T> | undefined) => {
    if (entries === undefined || !names.some((name) => entries.has(name)))
      return entries;
    const kept = new Map(entries);
    for (const name of names) kept.delete(name);
    return kept;
  };
  const declaredVarTypes = target.declaredVarTypes && {
    ...target.declaredVarTypes,
  };
  if (declaredVarTypes) for (const name of names) delete declaredVarTypes[name];
  return {
    boundVars: withBoundNames(target, names),
    declaredVarTypes,
    localFunctions: without(target.localFunctions),
    lexicalFunctions: without(target.lexicalFunctions),
    reboundFunctions: without(target.reboundFunctions),
  };
}

/**
 * Extend a target's `boundVars` set with additional locally-bound names
 * (lambda parameters, loop indices, block locals, comprehension variables,
 * `Match` captures). Returns a set suitable for spreading into an inner
 * target alongside its `var` override, so `compile` recognizes a
 * value-position reference to the bound name as a local — not a free
 * user-function reference to capture — even when the binding form resolves
 * the name to non-identity code. See finding A2. Empty `names` returns the
 * existing set unchanged (no allocation).
 *
 * The new set records which set it extends and which names it adds
 * (`recordScopeParent`). A fact keyed on a bound-variable set — a loop
 * index whose values the emitted code produces itself — is then still
 * readable from inside a nested binder, while a name that nested binder
 * rebinds stops at its own frame.
 */
export function withBoundNames(
  target: CompileTarget<Expression>,
  names: ReadonlyArray<string>
): ReadonlySet<string> | undefined {
  const nonEmpty = names.filter((n) => n !== '' && n !== undefined);
  if (nonEmpty.length === 0) return target.boundVars;
  const s = new Set(target.boundVars);
  for (const n of nonEmpty) s.add(n);
  recordScopeParent(s, target.boundVars, nonEmpty);
  return s;
}

/**
 * The naming context of the compilation `target` belongs to, installing a
 * fresh one when the target has none.
 *
 * Every root compilation boundary creates the context (each target's
 * `createTarget()`, `compile-expression.ts` for the direct custom-target
 * route), and `compile()` installs one on the OUTERMOST call for a
 * hand-rolled target that has none — before any `{ ...target }` spread, so
 * every copy shares the one reference. This last-resort fallback therefore
 * only fires for a target reached with no compilation around it at all
 * (`tempVar()` called directly by a target's own helper); installing it on a
 * spread COPY would fork the counter, and two branches would then allocate
 * the same name.
 */
export function namingContext(
  target: CompileTarget<Expression>
): NamingContext {
  let naming = target.naming;
  if (naming === undefined) {
    naming = { counter: 0, usedNames: new Set<string>() };
    target.naming = naming;
  }
  return naming;
}

/**
 * A fresh naming context for a root compilation of `expr`.
 *
 * `sources` are the caller-supplied source strings spliced into the emitted
 * code (`functions` entries that are strings, string-valued `vars`, the
 * `preamble`): they are scanned for `_tv`/`_cse` tokens so a generated temp
 * never captures a name a splice introduces.
 *
 * `extra` are identifiers the caller supplies OUT of band that the emitter
 * writes bare — the Python target's `compileFunction`/`compileLambda`
 * parameter lists. (Names that come from the expression, e.g. a `Function`
 * literal's parameters, are already covered by the walk.)
 */
export function newNamingContext(
  expr?: Expression | ReadonlyArray<Expression | undefined>,
  sources?: ReadonlyArray<string | undefined>,
  extra?: ReadonlyArray<string>
): NamingContext {
  return { counter: 0, usedNames: collectUsedNames(expr, sources, extra) };
}

/**
 * Restart the generated-name numbering of the compilation `target` belongs
 * to, keeping its collision inventory.
 *
 * The mirror of the GPU targets' random-counter reset: a target the CALLER
 * built once and passes to two successive compilations would otherwise
 * number the second compilation's temporaries from where the first stopped.
 */
export function resetNaming(target: CompileTarget<Expression>): void {
  namingContext(target).counter = 0;
  resetJavaScriptStatements(target);
}

/**
 * Generate a temporary variable name: `_tv1`, `_tv2`, … from the target's
 * naming context, skipping any name the compilation already uses.
 *
 * Deterministic by construction — the same expression compiled twice emits
 * byte-identical source (it used to draw from `Math.random()`).
 */
export function tempVar(target: CompileTarget<Expression>): string {
  const naming = namingContext(target);
  let name: string;
  do {
    name = `_tv${++naming.counter}`;
  } while (naming.usedNames.has(name));
  return name;
}
