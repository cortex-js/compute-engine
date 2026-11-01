import type { Expression } from '../global-types.js';
import { isOperatorDef, isValueDef } from './definition-guards.js';
import { optionalParameterTarget } from './function-literal.js';
import { isFunction, isSymbol, sym } from './type-guards.js';

/**
 * The names that the parameters of the function literal `fn` bind. Empty
 * when `fn` is not a function literal.
 */
export function callbackParameterNames(fn: Expression): Set<string> {
  const params = new Set<string>();
  if (!isFunction(fn, 'Function')) return params;
  for (const operand of fn.ops.slice(1)) {
    // A parameter with a default value, `["Optional", p, d]`, binds the
    // name of `p`.
    const p = optionalParameterTarget(operand);
    const name = sym(p) ?? (isFunction(p, 'Typed') ? sym(p.op1) : undefined);
    if (name !== undefined) params.add(name);
  }
  return params;
}

/**
 * True when `test` is true for one of the names that `e` reads: a symbol,
 * or the operator name of a call. The walk stops at the first such name.
 *
 * `.symbols` is not used, because it leaves out the operator names: the
 * function `h` of a call `h(1)` is read by name, as a symbol is.
 *
 * A name that a binder inside `e` binds (the index of a `Sum`, a local of a
 * `Block`, the parameter of a nested function) is also given to `test`. The
 * caller must treat it as a name that it does not know, which is safe for
 * a guard that declines when it is not sure.
 */
export function someNameRead(
  e: Expression,
  test: (name: string, node: Expression) => boolean
): boolean {
  if (isSymbol(e)) return test(e.symbol, e);
  if (!isFunction(e)) return false;
  return test(e.operator, e) || e.ops.some((op) => someNameRead(op, test));
}

/**
 * True when `fn` (a symbol, a function literal, or another expression)
 * reads a name that the current scope of `ce` binds to a definition that is
 * not the definition that `fn` is bound to. Such a callback is a closure: it
 * reads a variable of another scope (`Block(c := 5, Map(x ↦ x/c, …))`, read
 * after the `Block` returned), and a callback made again from MathJSON in the
 * current scope does not read that variable.
 *
 * The parameters of a function literal are not checked: they are bound by
 * the literal. A name of a scope inside the body (a local of a `Block`, the
 * index of a `Sum`, the parameter of a nested function) is bound to that
 * scope, and it makes the result `true`. The result is then `true` for a
 * callback that is not a closure, which is safe: the callback is applied as
 * it is (see `lazyMapNumericApproximation()`, `collection-utils.ts`).
 */
export function readsOtherBindings(
  ce: Expression['engine'],
  fn: Expression
): boolean {
  const current = (name: string): unknown => {
    const def = ce.lookupDefinition(name);
    return isValueDef(def)
      ? def.value
      : isOperatorDef(def)
        ? def.operator
        : undefined;
  };
  const params = callbackParameterNames(fn);
  return someNameRead(
    isFunction(fn, 'Function') ? fn.op1 : fn,
    (name, node) => {
      if (isSymbol(node))
        return !params.has(name) && node.baseDefinition !== current(name);
      // A call is bound to the operator definition of its operator, or to
      // the value definition of a symbol whose value is a function: `h(x)`
      // for a local `h := z ↦ 2z` of a `Block` has no operator definition.
      // A call that is bound to no definition is also taken as a closure:
      // the current scope can bind its operator to another definition.
      const def = node.baseDefinition;
      return def === undefined || def !== current(name);
    }
  );
}
