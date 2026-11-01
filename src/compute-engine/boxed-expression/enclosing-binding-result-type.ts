import type { Type } from '../../common/type/types.js';
import { isSubtype, widen } from '../../common/type/subtype.js';
import { broadcastShapedResultType } from '../../common/type/utils.js';
import { parseType } from '../../common/type/parse.js';
import type { BoxedDefinition, Expression, Scope } from '../global-types.js';
import { isFunction, isSymbol } from './type-guards.js';
import { staticBindingIn, staticParentOf } from '../static-typing-view.js';

/**
 * The type of a `D` or of an indefinite `Integrate`, after the values that
 * the enclosing bindings of its variables can hold are taken into account.
 *
 * `D` and `Integrate` bind their variables in their own scope, so their type
 * handler types the operand with a scalar variable. The value of the
 * derivative or of the antiderivative still holds the variable (`D(a^2, a)`
 * is `2a`), and outside the operator that symbol reads the binding that
 * encloses it: a parameter of a function literal, a block local, or a
 * global. When that binding holds a list, the value is a list:
 * `((a: list<real>) ↦ D(a^2, a))([1, 2])` is `[2, 4]`, and with a global
 * `g: list<real>` the value of `D(g^2, g)` is `2g`, of type `list<real>`.
 *
 * The closed form does not always hold the variable: `D(3a, a)` is `3`,
 * `D(5, a)` is `0`. So the type is the union of `result` and of the type of
 * the values that the bindings give:
 *
 * - A variable with no enclosing binding outside the system scope, or whose
 *   enclosing binding has the type `unknown` or a numeric type, leaves
 *   `result` as it is. An `unknown` binding is read as a number, as in the
 *   rest of the engine (`x ↦ 2x` is typed `(unknown) -> number`).
 * - When every other enclosing binding is a tensor of numbers and `result`
 *   is numeric, the value is `result` or its broadcast over these tensors
 *   (`broadcastShapedResultType()`): `number | list<number>`.
 * - Otherwise the type is `any`, the only type that holds every value the
 *   evaluation can give. This covers a binding that can hold a string, a
 *   ragged list or a value of any type, and a result that is not a number:
 *   the cells of a list result are broadcast one by one, so
 *   `D([a^2, a^3], a)` with `a = [1, 2, 3]` is `[[2, 4, 6], [3, 12, 27]]`,
 *   whose nesting the type of the result does not give.
 *
 * A definite integral has no free variable, so its type is not changed.
 */
export function withEnclosingBindingsOfVariables(
  expr: Expression,
  result: Type
): Type {
  const tensors: Type[] = [];
  for (const { type: t } of nonScalarEnclosingBindings(expr)) {
    if (!isSubtype(t, TENSOR_OF_NUMBERS)) return 'any';
    tensors.push(t);
  }
  if (tensors.length === 0) return result;
  if (!isSubtype(result, 'number')) return 'any';
  return widen(result, broadcastShapedResultType(tensors, result));
}

const TENSOR_OF_NUMBERS: Type = parseType('tensor<number>');

/**
 * The enclosing bindings of the variables of a `D` or of an indefinite
 * `Integrate` (see `withEnclosingBindingsOfVariables()`) whose type is not
 * `unknown` and not numeric: the bindings that can give the value of the
 * operator the shape of a collection. Empty for any other expression.
 */
export function nonScalarEnclosingBindings(
  expr: Expression
): { name: string; binding: BoxedDefinition; type: Type }[] {
  const found: { name: string; binding: BoxedDefinition; type: Type }[] = [];
  if (!isFunction(expr)) return found;
  const scope = expr.localScope;
  if (scope === undefined) return found;
  const system = expr.engine.contextStack[0]?.lexicalScope;
  for (const name of variableNames(expr)) {
    const binding = enclosingBinding(scope, system, name);
    if (binding === undefined || !('value' in binding)) continue;
    const type = binding.value.type.type;
    if (type === 'unknown' || isSubtype(type, 'number')) continue;
    found.push({ name, binding, type });
  }
  return found;
}

/** The names of the variables that remain free in the value of `expr`: every
 * variable of a `D`, and the variable of each `Limits` of an `Integrate`
 * that has no bounds (`Limits(x, Nothing, Nothing)`). */
function variableNames(expr: Expression): string[] {
  const names: string[] = [];
  if (!isFunction(expr)) return names;
  if (expr.operator === 'D') {
    for (const v of expr.ops.slice(1)) if (isSymbol(v)) names.push(v.symbol);
  } else if (expr.operator === 'Integrate') {
    for (const l of expr.ops.slice(1)) {
      if (
        isFunction(l, 'Limits') &&
        isSymbol(l.op1) &&
        isSymbol(l.op2, 'Nothing') &&
        isSymbol(l.op3, 'Nothing')
      )
        names.push(l.op1.symbol);
    }
  }
  return names;
}

/** The binding of `name` in the scopes that enclose `scope` (the scope of
 * the operator, which binds the variable itself), in the static view of the
 * bindings. The system scope is not read: a library constant with the same
 * name is not the value of a variable. */
function enclosingBinding(
  scope: Scope,
  system: Scope | undefined,
  name: string
): BoxedDefinition | undefined {
  let s = staticParentOf(scope);
  while (s !== null && s !== system) {
    const binding: BoxedDefinition | undefined = staticBindingIn(
      s,
      name,
      false
    );
    if (binding !== undefined) return binding;
    s = staticParentOf(s);
  }
  return undefined;
}
