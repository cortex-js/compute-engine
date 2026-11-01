// Parameters with a default value (`["Optional", param, default]`) in
// compiled function literals.

import type { Expression } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { isSubtype } from '../../common/type/subtype.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import {
  functionLiteralParameterType,
  isRestParameter,
  optionalParameterDefault,
  requiredParameterCount,
} from '../boxed-expression/function-literal.js';
import { callSiteDefault } from '../boxed-expression/parameter-defaults.js';

/**
 * True when the `Function` literal `literal` has a parameter with a default
 * value: `(x, k = 2) => x * k` is `["Function", body, "x", ["Optional", "k", 2]]`.
 */
export function literalHasParameterDefaults(literal: Expression): boolean {
  return (
    isFunction(literal, 'Function') &&
    literal.ops.slice(1).some((p) => optionalParameterDefault(p) !== undefined)
  );
}

/**
 * The arguments of a call of the `Function` literal `literal` with the
 * written arguments `actuals`, completed with the default operand of each
 * parameter with a default that the call leaves out.
 *
 * Each added operand is the default as the call would read it if the author
 * had written it in the call (`callSiteDefault()`): a value default is the
 * value, and a symbol default is the symbol read at the call site. So the
 * caller compiles the completed call as a call that supplies every argument.
 *
 * Returns `actuals` itself when nothing is left out, and `undefined` when the
 * literal has a rest parameter (its arguments are not completed) or when the
 * count of `actuals` is outside the range the literal accepts: fewer than its
 * required parameters (the interpreter curries such a call) or more than its
 * parameters (the interpreter rejects such a call).
 */
export function completedLiteralArguments(
  literal: Expression,
  actuals: ReadonlyArray<Expression>
): ReadonlyArray<Expression> | undefined {
  if (!isFunction(literal, 'Function')) return undefined;
  const params = literal.ops.slice(1);
  if (params.some((p) => isRestParameter(p))) return undefined;
  if (actuals.length > params.length) return undefined;
  if (actuals.length < requiredParameterCount(params)) return undefined;
  if (actuals.length === params.length) return actuals;
  const added: Expression[] = [];
  for (const p of params.slice(actuals.length)) {
    const d = optionalParameterDefault(p);
    if (d === undefined) return undefined;
    added.push(callSiteDefault(d));
  }
  return [...actuals, ...added];
}

/**
 * True when a call of the `Function` literal `literal` with `count` arguments
 * is a full call: at least the required parameters and at most all of the
 * parameters. A literal with a rest parameter accepts exactly its parameter
 * count here, as before parameters could have a default.
 */
export function literalAcceptsArgumentCount(
  literal: Expression,
  count: number
): boolean {
  if (!isFunction(literal, 'Function')) return false;
  const params = literal.ops.slice(1);
  if (params.some((p) => isRestParameter(p))) return count === params.length;
  return count >= requiredParameterCount(params) && count <= params.length;
}

/**
 * True when the `Function` literal `literal` has no rest parameter, at most
 * `count` required parameters, at least `count` parameters, and a default
 * value for each parameter after the first `count`. A consumer that calls a
 * callback with `count` arguments (`Map` over `count` collections) can then
 * write the call out with the defaults of the other parameters
 * (`completedLiteralArguments()`). The interpreter calls `(x = 1) => 2 * x`
 * with one argument in `Map`, so that literal takes one argument.
 */
export function literalTakesArgumentCount(
  literal: Expression,
  count: number
): boolean {
  if (!isFunction(literal, 'Function')) return false;
  const params = literal.ops.slice(1);
  if (params.some((p) => isRestParameter(p))) return false;
  if (requiredParameterCount(params) > count || params.length < count)
    return false;
  return params
    .slice(count)
    .every((p) => optionalParameterDefault(p) !== undefined);
}

/**
 * True when the value of the parameter operand `param` can be `Missing`.
 *
 * On the JavaScript target `undefined` is the run-time value of `Missing`,
 * and a JavaScript default parameter (`(x, k = 2) => …`) is used for an
 * argument that is `undefined`, not only for an argument that is left out.
 * The interpreter keeps a `Missing` that the call supplies. So a parameter
 * with a default whose type can hold `missing` (a parameter without an
 * annotation, whose type is `unknown`, or `k: number | missing = 2`) is
 * completed from the number of arguments of the call instead
 * (`defaultFillingWrapper()`).
 *
 * `slotType` is the type of the parameter in the signature of the literal,
 * used when the parameter has no annotation.
 */
export function parameterCanBeMissing(
  param: Expression,
  slotType: Type | undefined
): boolean {
  const t = functionLiteralParameterType(param) ?? slotType ?? 'unknown';
  return isSubtype('missing', t);
}

/**
 * How a compiled JavaScript function fills a parameter with a default value
 * that a call leaves out: `code` is the compiled default, evaluated at each
 * call that leaves the parameter out, and `byCount` is true when the fill
 * tests the number of arguments of the call instead of a JavaScript default
 * parameter (`parameterCanBeMissing()`).
 */
export type DefaultFill = { code: string; byCount: boolean };

/**
 * The fill of each parameter operand of a `Function` literal, `params`, by
 * position: `undefined` for a parameter without a default. `compile` compiles
 * the default operand as an operand written at the call site
 * (`callSiteDefault()`), so a symbol default is read when the call is made.
 * `slotType(i)` is the type of the parameter `i` in the signature that the
 * emitted function implements, used for a parameter without an annotation.
 */
export function literalDefaultFills(
  params: ReadonlyArray<Expression>,
  compile: (e: Expression) => string,
  slotType: (i: number) => Type | undefined
): (DefaultFill | undefined)[] {
  return params.map((p, i) => {
    const d = optionalParameterDefault(p);
    if (d === undefined) return undefined;
    return {
      code: compile(callSiteDefault(d)),
      byCount: parameterCanBeMissing(p, slotType(i)),
    };
  });
}

/**
 * A JavaScript function that calls `callee` with every argument, after it
 * fills each parameter that the call leaves out with its default (`fills`,
 * one entry per parameter, `undefined` for a parameter without a default).
 *
 * When no fill tests the number of arguments, the result is an arrow with
 * JavaScript default parameters: `(_tv1, _tv2 = 2) => callee(_tv1, _tv2)`.
 * Otherwise it is an arrow with a rest parameter, which tests the number of
 * arguments: `(..._tv3) => { let [_tv1, _tv2] = _tv3; if (_tv3.length < 2)
 * _tv2 = 2; return callee(_tv1, _tv2); }`, in parentheses. The count is not
 * read from `arguments`: in a `function`, a default that reads a name
 * `arguments` of the enclosing code (a parameter of an outer literal) would
 * read the `arguments` object of the wrapper instead.
 *
 * `fresh()` gives a parameter name that no other name of the emitted code
 * uses.
 */
export function defaultFillingWrapper(
  callee: string,
  fills: ReadonlyArray<DefaultFill | undefined>,
  fresh: () => string
): string {
  const params = fills.map(() => fresh());
  const args = params.join(', ');
  if (!fills.some((f) => f?.byCount === true)) {
    const declared = params.map((p, i) =>
      fills[i] === undefined ? p : `${p} = ${fills[i]!.code}`
    );
    return `(${declared.join(', ')}) => ${callee}(${args})`;
  }
  const rest = fresh();
  const tests = fills
    .map((f, i) =>
      f === undefined
        ? ''
        : `if (${rest}.length < ${i + 1}) ${params[i]} = ${f.code}; `
    )
    .join('');
  // In parentheses, so that the text is an expression also at the start of
  // a statement.
  return `((...${rest}) => { let [${args}] = ${rest}; ${tests}return ${callee}(${args}); })`;
}
