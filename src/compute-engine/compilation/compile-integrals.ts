// Closed-form integrals of the existing compilers: the antiderivative-first
// attempt (`closed-form-integral.ts`, shared with the IR pipeline) with the
// angular-unit test of the constant folder, and the integrand of a numeric
// integration.

import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';
import {
  isSymbol,
  isFunction,
  isDictionary,
} from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import {
  implicitIntegrationVariable,
  unusedVariableName,
} from '../boxed-expression/integration-variables.js';
import { multiClauseState } from '../multi-clause.js';
import { UNIT_DEPENDENT_HEADS } from './angular-unit.js';
import { CompilerState } from './compiler-state.js';
import { userFunctionLiteral } from './compile-assignment-checks.js';
import {
  assertNoDestructuringParams,
  assertNoRestParams,
} from './compile-declarations.js';
import {
  closedFormIntegral as closedFormIntegralWith,
  type ClosedFormTarget,
} from './closed-form-integral.js';

export {
  ANTIDERIVATIVE_ATTEMPT_HANG_MS,
  MAX_ANTIDERIVATIVE_TIMEOUT_RECORDS,
  antiderivativeKey,
  antiderivativeStateStamp,
  antiderivativeTimeouts,
  definitionIds,
  recordedTypeLists,
  referencesVarsSymbol,
  resetSharedCompilationBudgets,
  setAntiderivativeAttemptBudgetForTesting,
  shadowedOperandSymbols,
  withCompilationBudgets,
  type ClosedFormTarget,
} from './closed-form-integral.js';

/**
 * Does `expr` read a stored definition — the value of an assigned symbol,
 * or the body of a user function that it calls or passes as a value — that
 * contains, at any depth, a head whose meaning depends on the angular unit
 * (`Sin`, `Arcsin`, `Degrees`, …; see `UNIT_DEPENDENT_HEADS`)?
 *
 * The heads of `expr` itself do not count, unless `stored` says that
 * `expr` is itself a stored definition: the compile entry rewrote the
 * compiled tree for the angular unit, and only a stored definition keeps
 * the engine's unit.
 * Linear in the distinct nodes of `expr`; each name is answered once per
 * compilation.
 */
export function readsAngularDefinition(
  expr: Expression,
  stored = false
): boolean {
  const seen = new Set<Expression>();
  const visit = (node: Expression): boolean => {
    if (isSymbol(node))
      return nameHasAngularDefinition(node.engine, node.symbol);
    if (seen.has(node)) return false;
    seen.add(node);
    if (isDictionary(node)) return node.values.some(visit);
    if (isFunction(node))
      return (
        (stored && UNIT_DEPENDENT_HEADS.has(node.operator)) ||
        node.ops.some(visit) ||
        nameHasAngularDefinition(node.engine, node.operator)
      );
    return false;
  };
  return visit(expr);
}

/**
 * Does the stored definition of `name` (its assigned value, its function
 * literal, or the literal of each clause of a multi-clause function)
 * contain a unit-dependent head, directly or through the definitions it
 * reads? A definition that refers to itself answers `false` at the
 * re-entry.
 */
export function nameHasAngularDefinition(
  engine: ComputeEngine,
  name: string
): boolean {
  const memo = CompilerState._angularDefinitionMemo;
  const known = memo.get(name);
  if (known !== undefined) return known;
  memo.set(name, false);
  const definitions = storedDefinitions(engine, name);
  const hit = definitions.some((d) => readsAngularDefinition(d, true));
  memo.set(name, hit);
  return hit;
}

/**
 * The stored definitions of `name`: its assigned value, its function
 * literal, and the literal of each clause of a multi-clause function.
 */
export function storedDefinitions(
  engine: ComputeEngine,
  name: string
): Expression[] {
  const definitions: Expression[] = [];
  const value = engine._getSymbolValue(name);
  if (value !== undefined) definitions.push(value);
  let literal: Expression | undefined;
  try {
    literal = userFunctionLiteral(engine, name);
  } catch {
    // A literal whose captured types are no longer current is refused by
    // the compilation of the call itself. This test only reads the body.
    literal = undefined;
  }
  if (literal !== undefined && literal !== value) definitions.push(literal);
  const clauses = multiClauseState(engine.lookupDefinition(name))?.clauses;
  if (clauses !== undefined)
    for (const c of clauses) definitions.push(c.literal);
  return definitions;
}

/**
 * The integrand of `Integrate(f, limit₁, …, limitₙ)` as a body in the
 * limits' index variables, with the lambda variable to bind for each limit
 * — `{ lambdaVars, bodyExpr }` — or a thrown decline (D6).
 *
 * A bare integrand is already a body in the limits' index variables. A
 * `Function(body, …params)` integrand is unwrapped to its body, and its
 * parameters are matched to the limits BY NAME, as the interpreter does
 * (`nIntegrateMultiple` in `library/calculus.ts`): every limit's index
 * variable must name exactly one parameter and no parameter may be left
 * over. Pairing them by POSITION instead — the lambda for limit d named
 * after parameter d — bound `Function(a·x·y², y, x)` under the limits
 * `(x, 0, 1), (y, 0, 2)` with `y` over x's range, computing ∫∫ a·y·x² in
 * place of ∫∫ a·x·y²; and a spare parameter (`Function(x + q, x, q)` under
 * one limit) compiled `q` as an ambient `vars` read the integral never
 * supplies, where the interpreter declines. A destructuring parameter, and
 * any parameter with no readable name, decline as well: dropping the
 * wrapper would compile the body's references to what they bind as reads
 * of the enclosing scope.
 *
 * `lambdaVars[d]` is limit d's index variable — after the check, the
 * parameter it binds — so the caller nests one lambda per limit in limit
 * order.
 */
export function integrandLambda(
  integrand: Expression,
  limitIndices: ReadonlyArray<string>,
  limitExprs?: ReadonlyArray<Expression>
): { lambdaVars: string[]; bodyExpr: Expression } {
  // A limit that names no variable (`Limits(Nothing, a, b)`, index
  // `Nothing`) takes the variable that the interpreter gives it
  // (`implicitIntegrationVariable`). When the integrand has no parameter for
  // it, the integrand is constant in that dimension, and the lambda of the
  // limit binds a name that the integrand and the bounds do not read.
  const constantVars = new Set<string>();
  const resolved = limitIndices.map((index, d) => {
    if (index !== 'Nothing' || limitExprs === undefined) return index;
    const implicit = implicitIntegrationVariable(integrand, limitExprs, d);
    if (implicit === null)
      throw new Error(
        `Could not compile \`Integrate\`: a limit with no variable, for an ` +
          `integrand whose parameter has no readable name or whose value is ` +
          `a function. The interpreter keeps the integral unevaluated.`
      );
    if (implicit !== undefined) return implicit;
    const fresh = unusedVariableName([integrand, ...limitExprs], constantVars);
    constantVars.add(fresh);
    return fresh;
  });
  const lambdaVars = [...resolved];
  if (!isFunction(integrand, 'Function'))
    return { lambdaVars, bodyExpr: integrand };
  const params = integrand.ops.slice(1);
  assertNoDestructuringParams(params);
  assertNoRestParams(params);
  const names = params.map((p) => functionLiteralParameterName(p));
  // `functionLiteralParameterName` returns `''` — never `undefined` — for a
  // parameter operand that is not a name.
  const unreadable = params.find((_p, i) => names[i] === '');
  if (unreadable !== undefined)
    throw new Error(
      `Could not compile \`Integrate\`: an integrand whose parameter ` +
        `"${unreadable.toString()}" has no readable name — the body's ` +
        `references to what it binds would compile as references to the ` +
        `enclosing scope. Use a named parameter, or an ` +
        `integrand expressed directly in the limits' index variables.`
    );
  const bound = resolved.filter((v) => !constantVars.has(v));
  const oneToOne =
    names.length === bound.length &&
    new Set(names).size === names.length &&
    bound.every((v) => names.includes(v));
  if (!oneToOne)
    throw new Error(
      `Could not compile \`Integrate\`: the integrand's parameters ` +
        `(${names.join(', ') || 'none'}) do not match the integration ` +
        `variables (${resolved.join(', ') || 'none'}) one to one. The ` +
        `interpreter declines such an integral, and pairing them by ` +
        `position would bind a parameter to the wrong range.`
    );
  return { lambdaVars, bodyExpr: integrand.ops[0] };
}

/**
 * The closed form of `Integrate(f, (x, a, b))` for the existing compilers,
 * or `undefined`: `closedFormIntegral()` of `closed-form-integral.ts`, with
 * the test of the constant folder for a stored definition that depends on
 * the angular unit (`readsAngularDefinition()`).
 */
export function closedFormIntegral(
  args: ReadonlyArray<Expression>,
  target: ClosedFormTarget
): Expression | undefined {
  return closedFormIntegralWith(args, target, (a) => readsAngularDefinition(a));
}
