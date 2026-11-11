import type { Expression } from '../global-types.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isFunction, isSymbol, sym } from './type-guards.js';
import { functionLiteralParameterName } from './function-literal.js';
import { collectBinderNames, implicitVariableCandidates } from './utils.js';
import { isOperatorDef, isValueDef } from './definition-guards.js';

// The variable of an integration limit that names no variable
// (`Limits(Nothing, a, b)`). The interpreter (`Integrate` in
// `library/calculus.ts`) and the compile targets (`integrandLambda` in
// `compilation/compile-integrals.ts`) use the same rule, so that they
// integrate with respect to the same variable.

/**
 * The integration variable of the limit at index `i` of
 * `Integrate(f, ...limits)` when that limit names no variable
 * (`Limits(Nothing, a, b)`, from `\int_a^b f` with no `dx`). It is a
 * parameter of the function literal `f`, as the documentation says: the
 * variable can be omitted when it is the argument of the function. The
 * limits that name no variable take the parameters that no named limit
 * uses, in order: in `Integrate(Function(b, a, b), Limits(Nothing, 0, 1),
 * Limits(a, 0, 2))`, the first limit takes `b`. A bare-symbol integrand
 * (`x` in `\int_0^1 x`) is the function `x ↦ x`, and its symbol is the
 * variable of the first limit that names no variable. This is also true when
 * the symbol has an assigned value: the variable is a bound variable, and
 * the order of boxing and assignment does not change it. A constant (`Pi`)
 * is not a variable (`implicitVariableCandidates`).
 *
 * The result is:
 * - the name of the variable;
 * - `undefined` when the integrand has no parameter for the limit: the
 *   integrand does not depend on the variable of this limit, and its
 *   integral over `[a, b]` is `f·(b − a)`: `\int_0^1 \pi` is `π`. When
 *   no limit names a variable, the canonical form of `Integrate` makes the
 *   parameters of `f` from the symbols of the integrand, with or without a
 *   value, so with `x := 4`, `\int_0^1 \sqrt{x}` has the parameter `x` and
 *   its value is 2/3;
 * - `null` when the integral is not computed: a parameter that is not a
 *   name (a destructuring pattern), a bare-symbol integrand whose value is a
 *   function (`g` with `g := t ↦ t^2`, or `Sin`), which is not a constant.
 */
export function implicitIntegrationVariable(
  f: Expression,
  limits: ReadonlyArray<Expression>,
  i: number
): string | undefined | null {
  const variableOf = (l: Expression | undefined): string | undefined =>
    isFunction(l, 'Limits') ? sym(l.op1) : undefined;
  const named = new Set<string>();
  let position = 0;
  for (const [k, l] of limits.entries()) {
    const v = variableOf(l);
    if (v === 'Nothing') {
      if (k < i) position += 1;
    } else if (v) named.add(v);
  }
  if (isFunction(f, 'Function')) {
    const names = f.ops.slice(1).map((p) => functionLiteralParameterName(p));
    if (names.some((name) => name === '')) return null;
    return names.filter((name) => !named.has(name))[position];
  }
  if (isSymbol(f)) {
    // The integrand of `Integrate` is held: a bare symbol is not bound. Its
    // definition is looked up by name, and not through `.canonical`, which
    // would declare a name that has no definition. An operator definition
    // (`Sin`) is a function.
    const def = f.engine.lookupDefinition(f.symbol);
    if (
      isOperatorDef(def) ||
      (isValueDef(def) && isSubtype(def.value.type.type, 'function'))
    )
      return null;
    if (
      position === 0 &&
      !named.has(f.symbol) &&
      implicitVariableCandidates(f).includes(f.symbol)
    )
      return f.symbol;
  }
  return undefined;
}

/**
 * A name for the variable of a limit that names no variable, when the
 * integrand has no parameter for it (`implicitIntegrationVariable`). The
 * integrand does not read the variable, and the name must not capture a
 * symbol that the integrand reads. The name does not occur in `exprs` (the
 * integrand, its parameters and the bounds), is not in `avoid`, and has no
 * definition in the engine: a symbol that the integrand reads through an
 * assigned value or the body of a user function (`t` in `c := t + 1`) has a
 * definition, so the name cannot be one that a compile target inlines into
 * the integrand.
 */
export function unusedVariableName(
  exprs: ReadonlyArray<Expression>,
  avoid: Iterable<string> = []
): string {
  const used = new Set<string>(avoid);
  for (const e of exprs) {
    for (const name of e.symbols) used.add(name);
    for (const name of collectBinderNames(e)) used.add(name);
  }
  const ce = exprs[0]?.engine;
  // With the engine flag `_bindingUnits`, boxing declares no name, so a
  // symbol that the integrand reads through an assigned value or the body of
  // a user function can have no definition. These symbols are collected
  // from the values and the bodies.
  if (ce?._bindingUnits) {
    const pending = [...used];
    const visited = new Set<string>();
    while (pending.length > 0) {
      const name = pending.pop()!;
      if (visited.has(name)) continue;
      visited.add(name);
      const def = ce.lookupDefinition(name);
      if (def === undefined) continue;
      const held = isValueDef(def)
        ? def.value.value
        : isOperatorDef(def)
          ? def.operator._lambdaLiteral
          : undefined;
      if (held === undefined) continue;
      for (const inner of held.symbols) {
        used.add(inner);
        pending.push(inner);
      }
    }
  }
  for (let k = 0; ; k++) {
    const name = k === 0 ? 'IntegrationVariable' : `IntegrationVariable_${k}`;
    if (!used.has(name) && ce?.lookupDefinition(name) === undefined)
      return name;
  }
}
