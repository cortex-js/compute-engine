import type { Expression } from './global-types.js';
import { isFunction, isSymbol } from './boxed-expression/type-guards.js';
import { isOperatorDef, isValueDef } from './boxed-expression/utils.js';
import { lookupApplicable } from './function-utils.js';

/**
 * Resolve a derivative-head operand to a compilable univariate `Function`
 * literal. A literal passes through; a SYMBOL callee (`Derivative(f)` where
 * `f := x ↦ …`) resolves through its binding — the value-definition's stored
 * `Function` value, or the operator definition's `_lambdaLiteral` (the
 * literal a lambda-backed `f(x) := …` was installed from).
 * `canonicalFunctionLiteral` deliberately returns symbols unchanged (its
 * case 2), so it cannot do this resolution. Builtin operator symbols
 * (`Sin`) return `undefined` — their derivatives have closed forms, so the
 * fallback is never the right tool for them.
 *
 * The numeric derivative of `library/calculus.ts` and the structured route
 * of the JavaScript compiler (`numericDerivative()` in
 * `compilation/javascript-fragment-target.ts`) both read the operand with
 * this function.
 */
export function resolveDerivativeFunctionLiteral(
  expr: Expression | undefined
): Expression | undefined {
  if (expr === undefined) return undefined;
  let lit: Expression | undefined;
  if (isFunction(expr, 'Function')) lit = expr;
  else if (isSymbol(expr)) {
    // Prefer the instance's own binding; fall back to a BY-NAME lookup in
    // the current scope — a symbol operand reaching a compile handler is
    // not necessarily bound (the compilation walks operand instances that
    // may predate binding), the same reason `base-compiler.ts` resolves
    // operator heads with `lookupApplicable` rather than through the
    // instance.
    let vdef = expr.valueDefinition;
    let odef = expr.operatorDefinition;
    if (vdef === undefined && odef === undefined) {
      const found = lookupApplicable(
        expr.symbol,
        expr.engine.context.lexicalScope
      );
      if (found !== undefined && isOperatorDef(found)) odef = found.operator;
      else if (found !== undefined && isValueDef(found)) vdef = found.value;
    }
    const v = vdef?.value;
    lit =
      v !== undefined && isFunction(v, 'Function') ? v : odef?._lambdaLiteral;
  }
  if (lit === undefined || !isFunction(lit, 'Function')) return undefined;
  // Univariate only: `Function(body, param)`.
  if (lit.ops.length !== 2) return undefined;
  if (!lit.isPure) return undefined;
  return lit;
}
