// Parameters with a default value (`["Optional", param, default]`) in
// compiled function literals.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import type { CompileTarget } from './types.js';
import {
  isDictionary,
  isFunction,
  isNumber,
  isString,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import {
  blockLocalFunction,
  userFunctionLiteral,
} from './compile-assignment-checks.js';
import type { Type } from '../../common/type/types.js';
import {
  functionLiteralParameterType,
  isRestParameter,
  optionalParameterDefault,
  requiredParameterCount,
} from '../boxed-expression/function-literal.js';
import {
  literalSymbolNames,
  parameterDefaultOperands,
} from '../boxed-expression/parameter-defaults.js';
import { systemScopeBinding } from './builtin-callback.js';
import { isValueDef } from '../boxed-expression/definition-guards.js';

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
 * Each added operand is the default, a constant, as `compiledDefaultOperand()`
 * gives it: the value of a constant that the host or the program declares
 * takes the place of its name. So the caller compiles the completed call as
 * a call that supplies every argument. A default that compiled code does
 * not fill throws a decline.
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
    added.push(
      compiledDefaultOperand(
        literal.engine,
        d,
        functionLiteralParameterType(p),
        literal.toString()
      )
    );
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
 * True when compiled code does not fill the parameter default `d` of a
 * parameter of type `type` by its name (`undefined` for a parameter with
 * no annotation, or a parameter without a default when `d` is
 * `undefined`).
 *
 * The interpreter reads a symbol default where the function is declared
 * (`isConstantSymbolDefault()`). Compiled code reads a symbol by its name
 * where the default is filled: at the call, or in the wrapper of a callback.
 * A local of the same name there, or a `vars` entry that maps the name to
 * an input, would give another value. So compiled code fills a symbol
 * default by its name only when it is a constant of the standard library
 * that no definition of the engine hides (`Pi`, `Integers`), or a symbol
 * that the parameter type lists (`Auto` in `mode: symbol<Auto> |
 * symbol<Manual> = Auto`), which compiles to the symbol itself. For any
 * other symbol default, this function returns true, and compiled code
 * fills the value of the constant in place of its name
 * (`compiledDefaultOperand()`).
 *
 * A library constant or a listed symbol that a local of the call site
 * hides, or that `vars` maps, is still filled by name: a known limitation
 * (`docs/COMPILATION-MODEL.md`, "Known limitations").
 */
export function compiledSymbolDefaultDeclines(
  engine: ComputeEngine,
  d: Expression | undefined,
  type: Type | undefined
): boolean {
  if (d === undefined || !isSymbol(d)) return false;
  const name = d.symbol;
  if (name === 'True' || name === 'False') return false;
  if (type !== undefined && literalSymbolNames(type).includes(name))
    return false;
  const system = systemScopeBinding(engine, name);
  return !(
    system !== undefined &&
    isValueDef(system) &&
    system.value.isConstant === true &&
    engine.lookupDefinition(name) === system
  );
}

/**
 * The value of the constant that the symbol `d` names, when compiled code
 * can write it as a literal: a number, a string, `True`, `False`, or a
 * `List` or `Tuple` of such values, or an empty `Dictionary` (`{}`).
 * Otherwise `undefined`.
 *
 * The value is read from the definition that `d` was bound to when it was
 * boxed, not from a lookup of the name in the scope of the compilation. A
 * default is boxed where the function is declared, and the engine fills a
 * call that leaves the argument out with that same boxed symbol. So the
 * value is the one that the interpreter reads, also when a local of the
 * same name hides the constant where the call is made, or when `vars` maps
 * the name to an input.
 *
 * A definition that is not constant, or a constant with no value at
 * compile time, gives `undefined`. An Epsil `const` that the program
 * declares is such a constant before the program runs: the declaration
 * sets its value when it runs.
 */
function foldedConstantDefault(d: Expression): Expression | undefined {
  if (!isSymbol(d)) return undefined;
  const def = d.valueDefinition;
  if (def === undefined || def.isConstant !== true) return undefined;
  const value = def.value;
  if (value === undefined || !isLiteralValue(value)) return undefined;
  return value;
}

/** True when `x` is a literal value that compiled code can write: see
 * `foldedConstantDefault()`. */
function isLiteralValue(x: Expression): boolean {
  if (isNumber(x) || isString(x)) return true;
  if (isSymbol(x)) return x.symbol === 'True' || x.symbol === 'False';
  if (isFunction(x, 'List') || isFunction(x, 'Tuple'))
    return x.ops.every(isLiteralValue);
  // The engine boxes `{}` as a dictionary value, not as a `Dictionary`
  // function expression.
  return isDictionary(x) && x.count === 0;
}

/**
 * The operand that compiled code fills for the parameter default `d` of a
 * parameter of type `type`: `d` itself, or, for a constant that the host or
 * the program declares (`compiledSymbolDefaultDeclines()`), the value of
 * that constant (`foldedConstantDefault()`). With `W0` declared
 * `ce.declare('W0', { isConstant: true, value: 5 })` and
 * `f := (k = W0) ↦ k + 1`, `f()` compiles as `f(5)` and gives 6, as in the
 * interpreter.
 *
 * Throws a decline when the constant has no value that compiled code can
 * write. `subject` names what is compiled: the call, the function or the
 * callback.
 */
export function compiledDefaultOperand(
  engine: ComputeEngine,
  d: Expression,
  type: Type | undefined,
  subject: string
): Expression {
  if (!isSymbol(d) || !compiledSymbolDefaultDeclines(engine, d, type))
    return d;
  const value = foldedConstantDefault(d);
  if (value !== undefined) return value;
  throw new Error(
    `Could not compile \`${subject}\`: the default \`${d.symbol}\` names ` +
      `a constant that has no value that compiled code can write (a ` +
      `number, a string, a boolean, a list or tuple of such values, or ` +
      `\`{}\`); write the ` +
      `value as the default, or pass the argument.`
  );
}

/**
 * The call `expr` of a user function, with the value of the constant in
 * place of each argument that is a symbol default of a constant that the
 * host or the program declares (`compiledDefaultOperand()`). Returns `expr`
 * itself when no argument changes.
 *
 * The engine completes a call that leaves the argument out with the default
 * symbol when it canonicalizes the call (`f()` becomes `f(W0)`). So each
 * argument at a position with such a symbol default is read: an argument
 * that is that symbol is replaced by the value of the definition it was
 * bound to, also when the call wrote it (`f(W0)`): a written constant has
 * the same value. When that symbol has no value that compiled code can
 * write, the compilation declines: the argument can be the default, or a
 * variable of the same name that the call wrote, and the compiler cannot
 * tell which. An argument that the call leaves out is not added here: the
 * compilation of a block-local function call completes it
 * (`completedLiteralArguments()`).
 */
export function callWithCompiledDefaults(
  expr: Expression,
  target: CompileTarget<Expression>
): Expression {
  if (!isFunction(expr)) return expr;
  const h = expr.operator;
  const local = blockLocalFunction(h, target);
  if (local === null) return expr;
  const literal = local ?? userFunctionLiteral(expr.engine, h);
  if (literal === undefined) return expr;
  // A block-local function has no declared signature: its defaults and its
  // parameter types are those of its literal.
  const params = literal.ops.slice(1);
  const defaults =
    local !== undefined
      ? params.map((p) => optionalParameterDefault(p))
      : userFunctionDefaults(expr.engine, h, literal);
  const types =
    local !== undefined
      ? params.map((p) => functionLiteralParameterType(p))
      : userFunctionParameterTypes(expr.engine, h, literal);
  let changed = false;
  const ops = expr.ops.map((arg, i) => {
    const d = defaults[i];
    if (d === undefined || !isSymbol(d)) return arg;
    if (!(isSymbol(arg) && arg.symbol === d.symbol)) return arg;
    const operand = compiledDefaultOperand(
      expr.engine,
      arg,
      types[i],
      expr.toString()
    );
    if (operand !== arg) changed = true;
    return operand;
  });
  return changed ? expr.engine._fn(h, ops) : expr;
}

/**
 * The type of each parameter of the user function `h`, by position,
 * `undefined` for a parameter with no annotation: the type of the
 * signature declared for `h`, else the annotation of the parameter of its
 * literal `literal`. The positions match those of `userFunctionDefaults()`.
 */
export function userFunctionParameterTypes(
  engine: ComputeEngine,
  h: string,
  literal: Expression | undefined
): (Type | undefined)[] {
  const result: (Type | undefined)[] = [];
  if (literal !== undefined && isFunction(literal, 'Function'))
    literal.ops
      .slice(1)
      .forEach((p, i) => (result[i] = functionLiteralParameterType(p)));
  const def = engine.lookupDefinition(h);
  if (def !== undefined && isValueDef(def) && !def.value.inferredType) {
    const t = def.value.type.type;
    if (typeof t === 'object' && t.kind === 'signature')
      [...(t.args ?? []), ...(t.optArgs ?? [])].forEach(
        (a, i) => (result[i] = a.type)
      );
  }
  return result;
}

/**
 * The default operand of each parameter of the user function `h`, by
 * position, `undefined` for a parameter without a default: the default of
 * the signature declared for `h` (`ce.declare("fv", "(real, real = 2) ->
 * real")`, then `fv := (x, k) ↦ x + k`), else the default of the parameter
 * of its literal `literal` (`["Optional", k, 2]`). The declared default
 * comes first, as in the interpreter, which fills it at canonicalization
 * for a call that leaves the argument out (`makeCanonicalFunction()`,
 * `box.ts`): with `g` declared `(number, number = 2) -> number` and
 * assigned `(x, k = 3) ↦ x k`, `g(3)` is 6.
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
 * `AssertPresent`) on the JavaScript targets, for a
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
 * The test of `jsIsAbsent()` on the bound operand `_c` of a position whose
 * static type is a point of `n` coordinates, which also reads a `NaN` point
 * as absent: an array whose `n` coordinates are all `NaN`, as a read past
 * the end of a list of points gives (`_SYS.atPoint`). The interpreter reads
 * the same values as absent (`isMissingValue()`, `type-guards.ts`). The
 * coordinates are read only when `_c` is not `NaN`, `undefined` or
 * `null`, so a point position that holds one of those markers is read
 * without an error. The static type selects this test: the code does not
 * test the type of `_c` at run time.
 */
function jsPointAbsentTest(n: number): string {
  const coordinates = Array.from(
    { length: n },
    (_, i) => `Number.isNaN(_c[${i}])`
  ).join(' && ');
  return `Number.isNaN(_c ?? Number.NaN) || (${coordinates})`;
}

/** `IsMissing` at a point position of `n` coordinates on the JavaScript
 * target (`jsPointAbsentTest()`). The operand is bound to a parameter so it
 * is evaluated once. */
export const jsIsAbsentPoint = (x: string, n: number): string =>
  `((_c) => ${jsPointAbsentTest(n)})(${x})`;

/** `Coalesce` at a point position of `n` coordinates on the JavaScript
 * target: `x` unless `jsPointAbsentTest()` reads it as absent, else `d`,
 * evaluated only then. */
export const jsCoalescePoint = (x: string, d: string, n: number): string =>
  `((_c) => (${jsPointAbsentTest(n)}) ? ${d} : _c)(${x})`;
