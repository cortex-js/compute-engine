import type { Expression } from '../global-types.js';
import type { BoxedValueDefinition } from '../types-definitions.js';
import { isValueDef } from '../boxed-expression/definition-guards.js';
import {
  contextAssumedValues,
  withDeclaredTypeOnly,
  withShieldedValues,
} from '../boxed-expression/constraint-subject.js';

/**
 * Run `fn` (one compilation) with the stored value of every DECLARED symbol
 * named in `vars` hidden, and restore the values when `fn` returns or throws.
 *
 * A `vars` entry maps a symbol to a run-time input of the compiled code: the
 * code reads the input, never the engine value. But while the symbol holds a
 * value, every analysis the compiler runs on the expression sees that value:
 * with `a: real` and `a := 4`, `√a` saw a non-negative operand and compiled
 * to the real-only `Math.sqrt(_.a)`, which gives `NaN` when the input goes
 * negative, where the same symbol with no value compiles to the complex
 * `_SYS.csqrt`. Facts derived from the value (sign, integrality, a literal
 * type) must not reach the lane and type decisions, the constant folder or
 * the symbolic integration of an input. With the value hidden, the symbol
 * reads as the valueless input of its declared type for the whole
 * compilation, so the output is the same as for a symbol declared with no
 * value.
 *
 * Only a symbol with a declared type is hidden (`inferredType === false`). A
 * symbol whose type was inferred from its value (`ce.assign('u', 4)` with no
 * declaration) keeps its value: hiding it would leave a valueless inferred
 * binding, which a use inside the compilation could narrow, and that type
 * write would outlive the compilation. Constants cannot be written and are
 * skipped, and so is a symbol whose value is a function literal, whose body a
 * call inlines.
 *
 * The value is hidden and restored through the definition's `value` setter,
 * so each write moves the engine's cache generation: nothing cached while the
 * value was visible is served during the compilation, and nothing cached
 * during the compilation is served after it.
 *
 * A value put in force by an assumption (`assume(a = 4)`) is not stored on
 * the definition, so the setter cannot hide it. It is hidden with the value
 * shield of `assume()` (`withShieldedValues`), which makes the definition
 * read as valueless without a write, and an `assumption` state event on entry
 * and on exit moves the cache generation as the writes do. A shielded
 * definition is also marked with `withDeclaredTypeOnly`, so it takes its
 * declared type, without the facts the assumptions prove about it
 * (`BoxedValueDefinition.type`): `a = 4` would otherwise type `a` as an
 * integer. The value shield alone does not do this, because `assume()` uses
 * the same shield and needs the facts to apply. A symbol with only a stored value is not shielded: once
 * the value is hidden, the facts about it apply, as they do for a symbol
 * declared with no value.
 */
export function withVarsValuesHidden<T>(
  expr: Expression,
  vars: Readonly<Record<string, unknown>> | undefined,
  fn: () => T
): T {
  if (vars === undefined) return fn();
  let hidden: [BoxedValueDefinition, Expression][] | undefined;
  let shielded: Set<BoxedValueDefinition> | undefined;
  const ce = expr.engine;
  const assumed = contextAssumedValues(ce);
  for (const name of Object.keys(vars)) {
    const def = ce.lookupDefinition(name);
    if (!isValueDef(def)) continue;
    const v = def.value;
    if (v.isConstant || v.inferredType) continue;
    // A value an assumption puts in force (`assume(a = 4)`): shielded.
    if (assumed.has(v)) (shielded ??= new Set()).add(v);
    const stored = v.storedValue;
    if (stored === undefined || stored.operator === 'Function') continue;
    (hidden ??= []).push([v, stored]);
  }
  if (hidden === undefined && shielded === undefined) return fn();
  const shield = shielded;
  const run =
    shield === undefined
      ? fn
      : () => {
          ce._noteStateEvent({ kind: 'assumption' });
          try {
            return withDeclaredTypeOnly(shield, () =>
              withShieldedValues(shield, fn)
            );
          } finally {
            ce._noteStateEvent({ kind: 'assumption' });
          }
        };
  if (hidden === undefined) return run();
  try {
    for (const [def] of hidden) def.value = undefined;
    return run();
  } finally {
    for (const [def, stored] of hidden) def.value = stored;
  }
}
