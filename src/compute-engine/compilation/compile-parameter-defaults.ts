// Parameters with a default value (`["Optional", param, default]`) in
// compiled function literals.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { CompileTarget } from './types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  isRestParameter,
  optionalParameterDefault,
  requiredParameterCount,
} from '../boxed-expression/function-literal.js';
import {
  callSiteDefault,
  parameterDefaultOperands,
} from '../boxed-expression/parameter-defaults.js';
import { isValueDef } from '../boxed-expression/definition-guards.js';
import { mayHoldRestriction } from '../boxed-expression/conditional-value.js';
import { typeCannotBeAbsent } from '../library/core.js';
import { couldMatch } from '../../common/type/subtype.js';
import type { Type } from '../../common/type/types.js';

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
 * True when a value of the static type `t` can be absent when compiled code
 * runs: its type has a `missing` or `nan` member (`typeCannotBeAbsent()`),
 * or it can be a number, which compiled code holds as a float that can be
 * `NaN` (`0/0` with `x/y` typed `real`), or it is `unknown` or `any`. A
 * collection, a tuple, a string, a boolean, a symbol or a record cannot.
 */
export function mayBeAbsentAtRunTime(t: Type): boolean {
  return !typeCannotBeAbsent(t) || couldMatch(t, 'number');
}

/**
 * True when the argument `a` at a parameter whose default is `d` can be
 * absent when compiled code runs (`mayBeAbsentAtRunTime()`). A number
 * literal other than `NaN` cannot, nor can a symbol default that
 * canonicalization wrote into a call that leaves the parameter out: it is
 * the fill itself.
 */
export function argumentMayBeAbsent(a: Expression, d: Expression): boolean {
  if (isNumber(a) && a.isNaN !== true) return false;
  if (isSymbol(d) && isSymbol(a, d.symbol)) return false;
  // A restriction (`If(c, 3)`) is typed as its arm, but is absent where
  // its condition fails; so is an expression that contains one
  // (`If(c, If(d, True), False)`).
  return mayBeAbsentAtRunTime(a.type.type) || mayHoldRestriction(a);
}

/**
 * Decline, on the interval target, a call that supplies an argument that
 * can be absent at run time (`mayAbsent(i)`) to a parameter with a default
 * (`defaults`, by position). The interval target fills a default only for
 * an argument that the call leaves out: its absent value, the `empty`
 * result, is also the value of a pole or a domain error (`Sqrt(y - 5)`,
 * `1/(y - 3)` at `y = 3`), so a run-time fill would replace a present
 * value by the default. The interpreter fills an absent argument
 * (`withAbsentDefaults()`, `parameter-defaults.ts`), so such a call falls
 * back to it. `count` is the number of arguments the call supplies, and
 * `what` names the call in the message. Does nothing on another target.
 */
export function declineIntervalAbsentDefault(
  target: CompileTarget<Expression>,
  defaults: ReadonlyArray<Expression | undefined>,
  count: number,
  mayAbsent: (i: number) => boolean,
  what: string
): void {
  if (target.language !== 'interval-javascript') return;
  for (let i = 0; i < count; i++) {
    if (defaults[i] === undefined || !mayAbsent(i)) continue;
    throw new Error(
      `Could not compile ${what}: argument ${i + 1} can be absent at run ` +
        `time, at a parameter with a default value. The interval target ` +
        `does not fill a supplied absent argument with its default: its ` +
        `absent value is also the value of a pole or a domain error.`
    );
  }
}

/**
 * The default operand of each parameter of the user function `h`, by
 * position, `undefined` for a parameter without a default: the default of
 * the signature declared for `h` (`ce.declare("fv", "(real, real = 2) ->
 * real")`, then `fv := (x, k) ↦ x + k`), else the default of the parameter
 * of its literal `literal` (`["Optional", k, 2]`). The declared default
 * comes first, as in the interpreter, which fills it before it applies the
 * literal (`applyFunctionLiteralWith()`, `boxed-function.ts`): with `g`
 * declared `(number, number = 2) -> number` and assigned `(x, k = 3) ↦ x
 * k`, `g(3, At(L, 9))` is 6.
 */
export function userFunctionDefaults(
  engine: ComputeEngine,
  h: string,
  literal: Expression | undefined
): (Expression | undefined)[] {
  const result: (Expression | undefined)[] = [];
  if (literal !== undefined && isFunction(literal, 'Function'))
    literal.ops
      .slice(1)
      .forEach((p, i) => (result[i] = optionalParameterDefault(p)));
  const def = engine.lookupDefinition(h);
  if (def !== undefined && isValueDef(def) && !def.value.inferredType) {
    const t = def.value.type.type;
    const declared = parameterDefaultOperands(engine, def.value);
    if (
      declared !== undefined &&
      typeof t === 'object' &&
      t.kind === 'signature'
    ) {
      const first = t.args?.length ?? 0;
      declared.forEach((d, j) => {
        if (d !== undefined) result[first + j] = d;
      });
    }
  }
  return result;
}

/**
 * The arguments `actuals` of a call, with each argument at a parameter with
 * a default (`defaults`, by position, `userFunctionDefaults()`) replaced by
 * `Coalesce(argument, default)`, so that an argument that is absent when the
 * call runs takes the default, with the absence test of `Coalesce`.
 *
 * A default fills an absent argument as it fills an argument that the call
 * leaves out (`withAbsentDefaults()`, `parameter-defaults.ts`).
 * Canonicalization replaces an argument written absent (`f(Missing)`) and
 * completes a call that leaves an argument out, but an argument that
 * becomes absent when it is evaluated (`f(At(L, 100))`) is filled when the
 * call runs. A compiled call of a user function emitted as a definition
 * fills it here, at the call site: the default is then compiled as an
 * operand written at the call site, as the interpreter reads it
 * (`callSiteDefault()`). An argument that cannot be absent at run time
 * (`argumentMayBeAbsent()`: a list, a point, a string, a boolean, a number
 * other than `NaN`) is kept, as is a symbol default that canonicalization
 * wrote into the call. Wrapping a list or a point would give it a union
 * type (`integer | list<real>`) whose shape is not settled, and the call
 * would decline.
 *
 * Returns `actuals` itself when nothing is replaced.
 */
export function absentFilledArguments(
  defaults: ReadonlyArray<Expression | undefined>,
  actuals: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  let result: Expression[] | undefined;
  actuals.forEach((a, i) => {
    const d = defaults[i];
    if (d === undefined) return;
    if (!argumentMayBeAbsent(a, d)) return;
    result ??= [...actuals];
    result[i] = a.engine.function('Coalesce', [a, callSiteDefault(d)]);
  });
  return result ?? actuals;
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
 * The run-time absence test of every discharge (`IsMissing`, `Coalesce`,
 * `AssertPresent`, a parameter default) on the JavaScript targets, for a
 * position of any domain: `NaN`, `undefined` and `null` are absent, the
 * spellings an absent value has in compiled code (R1 and R3 of
 * `docs/plans/2026-11-01-absent-value-contract.md`).
 * `Number.isNaN(undefined)` is `false`, so the operand is coalesced to `NaN`
 * before the test; the operand is parenthesized because `??` may not be
 * mixed with an unparenthesized `&&`/`||` and it is spliced from arbitrary
 * code. `Number.isNaN` does not convert its operand, so a string, a list, a
 * complex `{ re, im }` or an interval is present.
 */
export const jsIsAbsent = (x: string): string =>
  `Number.isNaN((${x}) ?? Number.NaN)`;

/**
 * The compiled default of each parameter operand of a `Function` literal,
 * `params`, by position: `undefined` for a parameter without a default.
 * `compile` compiles the default operand as an operand written at the call
 * site (`callSiteDefault()`), so a symbol default is read when the call is
 * made.
 *
 * The emitted function fills a parameter with its default when the argument
 * is absent (`jsIsAbsent()`): left out (`undefined`), or supplied absent
 * (`undefined`, `null` or `NaN`, as `At(L, 100)` gives for a list of
 * numbers). The interpreter fills the same arguments with the same absence
 * test as `Coalesce` (`withAbsentDefaults()`, `parameter-defaults.ts`). A
 * JavaScript default parameter (`(x, k = 2) => …`) fills only `undefined`,
 * so it is not used.
 */
export function literalDefaultFills(
  params: ReadonlyArray<Expression>,
  compile: (e: Expression) => string
): (string | undefined)[] {
  return params.map((p) => {
    const d = optionalParameterDefault(p);
    return d === undefined ? undefined : compile(callSiteDefault(d));
  });
}

/**
 * The fill of a default in a compiled JavaScript-family function on the
 * target `target` (`defaultFillingWrapper()`): `coalesce(x, d)` is `x`, or
 * `d` when `x` is absent, with `d` evaluated only then. On the JavaScript
 * target it is the target's `Coalesce` (`CompileTarget.absence`), for which
 * `undefined`, `null` and `NaN` are absent. On the interval target it is
 * `undefined`: only an argument that the call leaves out is filled, with a
 * JavaScript default parameter (see `declineIntervalAbsentDefault()`).
 */
export function targetCoalesce(
  target: CompileTarget<Expression>
): ((x: string, d: string) => string) | undefined {
  if (target.language === 'interval-javascript') return undefined;
  return (
    target.absence?.object?.coalesce ??
    target.absence?.numeric.coalesce ??
    ((x, d) => `(${jsIsAbsent(x)} ? ${d} : ${x})`)
  );
}

/**
 * A JavaScript function that calls `callee` with every argument, after it
 * fills each parameter whose argument is absent (left out, or supplied
 * absent, by `coalesce`, the `Coalesce` of the target, `targetCoalesce()`)
 * with its default. Without `coalesce`, only a parameter that the call
 * leaves out (`undefined`) is filled, with a JavaScript default parameter:
 * `((_tv1, _tv2 = 2) => callee(_tv1, _tv2))`
 * (`fills`, one entry per parameter, `undefined` for a parameter without a
 * default):
 * `((_tv1, _tv2) => callee(_tv1, ((_c) => Number.isNaN(_c ?? Number.NaN) ?
 * 2 : _c)(_tv2)))` on the JavaScript target, in parentheses, so that the text is an expression also at the
 * start of a statement.
 *
 * `fresh()` gives a parameter name that no other name of the emitted code
 * uses, so a symbol default that the target spells as a parameter name of
 * the callee reads the binding of the call site.
 */
export function defaultFillingWrapper(
  callee: string,
  fills: ReadonlyArray<string | undefined>,
  fresh: () => string,
  coalesce: ((x: string, d: string) => string) | undefined
): string {
  const params = fills.map(() => fresh());
  if (coalesce === undefined)
    return `((${params
      .map((p, i) => (fills[i] === undefined ? p : `${p} = ${fills[i]}`))
      .join(', ')}) => ${callee}(${params.join(', ')}))`;
  const args = params.map((p, i) =>
    fills[i] === undefined ? p : coalesce(p, fills[i]!)
  );
  return `((${params.join(', ')}) => ${callee}(${args.join(', ')}))`;
}
