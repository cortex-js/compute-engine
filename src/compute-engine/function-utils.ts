import { BoxedExpression } from './public';

import { checkArity } from './boxed-expression/validate';

/***
 * ### THEORY OF OPERATIONS
 *
 * A `["Function"]` expression has its own scope.
 * This scope includes the parameters and local variables.
 *
 * Some expressions with anonymous parameters (e.g. `["Add", "_", 1]`)
 * are rewritten to a `["Function"]` expression with anonymous parameters
 * (e.g. `["Function", ["Add", "_", 1], "_"]`).
 *
 * The **body** of a `["Function"]` expression may have its own scope
 * (for example if it's a `["Block"]` expression) or may not have a scope
 * at all (if it's a number, i.e. `["Function", 1]`). the function body may
 * be a number, a symbol or (more commonly) an function expression.
 *
 *
 * #### DURING BOXING (in makeLambda())
 *
 * During the boxing/canonicalization phase of a function
 * (`["Function"]` expression or head expression):
 *
 * 1/ If not a `["Function"]` expression, the expression is rewritten
 *    to a `["Function"]` expression with anonymous parameters
 * 2/ A new scope is created
 * 3/ The function parameters are declared in the scope
 * 4/ The function body is boxed in the context of the scope and the scope
 *    is associated with the function
 *
 *
 * #### DURING EVALUATION (executing the result of makeLambda())
 *
 * 1/ The arguments are evaluated in the current scope
 * 2/ The context is swapped to the function scope
 * 3/ The values of all the ids in this scope are reset
 * 4/ The parameters are set to the value of the arguments
 * 5/ The function body is evaluated in the context of the function scope
 * 6/ The context is swapped back to the current scope
 * 7/ The result of the function body is returned
 *
 */

/**
 * From an expression, return a predicate function, which can be used to filter.
 */
export function predicate(
  _expr: BoxedExpression
): (...args: BoxedExpression[]) => boolean {
  // @todo
  return () => false;
}

/**
 * From an expression, create an ordering function, which can be used to sort.
 */
export function order(
  _expr: BoxedExpression
): (a: BoxedExpression, b: BoxedExpression) => -1 | 0 | 1 {
  // @todo
  //
  // Default comparator
  //
  return (a: BoxedExpression, b: BoxedExpression) => {
    if (a.isLess(b)) return -1;
    if (a.isEqual(b)) return 0;
    return 1;
  };
}

/**
 * Given an expression, rewrite it to a canonical Function form.
 *
 *
 * - explicit parameters (no change)
 *      ["Function", ["Add, "x", 1], "x"]
 *      -> ["Function", ["Add, "x", 1], "x"]
 *
 * - single anonymous parameters:
 *      ["Add", "_", 1]
 *      -> ["Function", ["Add", "_", 1], "_"]
 *
 * - multiple anonymous parameters:
 *      ["Add", "_1", "_2"]
 *      -> ["Function", ["Add", "_1", "_2"], "_1", "_2"]
 *
 */
export function canonicalFunctionExpression(
  expr: BoxedExpression
): BoxedExpression | undefined {
  //
  // Convert N operators:
  //  - N(Integrate) -> NIntegrate()
  //  - N(Limit) -> NLimit()
  //
  if (expr.head === 'N' && typeof expr.op1.head === 'string') {
    const newHead = { Integrate: 'NIntegrate', Limit: 'NLimit' }[expr.op1.head];
    if (newHead) expr = expr.engine._fn(newHead, expr.op1.ops!);
  }

  //
  // Is it a Function expression?
  //
  if (expr.head === 'Function') return expr;

  // @todo an expression could include a scoped environment
  // and we currently don't handle that case.
  // e.e. ["Function",
  //        ["Block",
  //          ["Add", "x", 1],
  //          ["Block",
  //            ["Declare", "x", "String"],   // shadow outer x
  //            ["Add", "x", 2],              // references inner x
  //          ]
  //        ]
  //      x"]

  // We have a "simple" expression, possibly with some
  // anonymous parameters, e.g. `["Add", "_1", "_2"]`

  let unknowns = expr.unknowns;

  if (unknowns.includes('_')) {
    expr = expr.subs({ _: '_1' });
    unknowns = expr.unknowns;
  }

  let count = 0;
  for (const unknown of unknowns) {
    if (unknown.startsWith('_')) {
      const n = Number(unknown.slice(1));
      if (n > count) count = n;
    }
  }

  const ce = expr.engine;
  const result = ce._fn('Function', [
    expr,
    ...Array.from({ length: count }, (_, i) => ce.symbol(`_${i + 1}`)),
  ]);
  return result;
}

/**
 *
 * Return a JS function that can be called with arguments.
 *
 * Input is a Function expression or an expression with anonymous
 * parameters.
 */

function makeLambda(
  expr: BoxedExpression
):
  | ((params: ReadonlyArray<BoxedExpression>) => BoxedExpression | undefined)
  | undefined {
  const ce = expr.engine;
  //
  // Is `expr` a function name, e.g. `Sin`
  //
  const fnDef = expr.symbol ? ce.lookupFunction(expr.symbol) : undefined;
  if (fnDef) {
    const fn = fnDef.signature.N ?? fnDef.signature.evaluate;
    if (fn) return (params) => fn(ce, params) ?? ce._fn(expr, params);
    return (params) => ce._fn(expr, params);
  }

  const fnExpr = canonicalFunctionExpression(expr);
  if (!fnExpr) return undefined;
  console.assert(fnExpr.head === 'Function');

  // Extract the parameters from the function signature ("x", "y")
  const params = fnExpr.ops!.slice(1).map((x) => x.symbol ?? 'Nothing');

  // Create a scope for the arguments and locals
  ce.pushScope();
  // Declare some "placeholders" for the parameters.
  // This is to avoid having the arguments bound to an id in a parent scope
  // with coincidentally the same name as the parameter.
  for (const param of params)
    ce.declare(param, { inferred: true, domain: undefined });
  const fn = fnExpr.op1.canonical;

  fn.bind();
  ce.popScope();

  const fnScope = fn.scope!;

  if (params.length === 0)
    return () => {
      const context = ce.swapScope(fnScope);
      ce.resetContext();
      const result = fn.N() ?? fn.evaluate();
      ce.swapScope(context);
      return result;
    };

  return (args) => {
    if (ce.strict) {
      args = checkArity(ce, args, params.length);
      if (!args.every((x) => x.isValid)) return undefined;
    }

    // Evaluate the arguments, in the current scope
    // (we don't want the arguments to be bound to the function scope)
    args = args.map((x) => x.evaluate());

    // Switch to the function lexical scope
    // which includes the (inferred) params and locals
    const context = ce.swapScope(fnScope);
    ce.resetContext();

    let i = 0;
    for (const param of params) ce.assign(param, args[i++]);

    const result = fn.N() ?? fn.evaluate();
    ce.swapScope(context);

    if (!result.isValid) return undefined;
    return result;
  };
}

/**
 * Apply arguments to an expression which is either
 * - a '["Function"]' expression
 * - an expression with anonymous parameters, e.g. ["Add", "_", 1]
 * - the identifier for a function, e.g. "Sin".
 */
export function apply(
  fn: BoxedExpression,
  args: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  return makeLambda(fn)?.(args) ?? fn.engine._fn(fn, args);
}

/**
 * Return a lambda function, assuming a scoped environment has been
 * created and there is a single numeric argument
 */
export function makeLambdaN1(
  expr: BoxedExpression
): ((arg: number) => number) | undefined {
  const lambda = makeLambda(expr);
  if (!lambda) return undefined;
  return (arg) =>
    (lambda([expr.engine.number(arg)])?.valueOf() as number) ?? NaN;
}

/**
 * Given an expression such as:
 * - ["Function", ["Add", 1, "x"], "x"]
 * - ["Function", ["Divide", "_", 2]]
 * - ["Multiply, "_", 3]
 * - ["Add, "_1", "_2"]
 * - "Sin"
 *
 * return a JS function that can be called with arguments.
 */
export function applicable(
  fn: BoxedExpression
): (args: BoxedExpression[]) => BoxedExpression | undefined {
  return makeLambda(fn) ?? ((args) => fn.engine._fn(fn.N(), args).N());
}

/**
 * Use applicableN when the function is known to be a function of a single
 * variable and the argument is a number.
 *
 * Unlike "apply", applicable returns a function  that can be called
 * with an argument.
 *
 */
export function applicableN1(fn: BoxedExpression): (x: number) => number {
  const ce = fn.engine;

  const lambda = makeLambda(fn);
  if (lambda) return (x) => (lambda([ce.number(x)])?.value as number) ?? NaN;

  return (x) => ce._fn(fn.evaluate(), [ce.number(x)]).value as number;
}

// xcas/gias https://www-fourier.ujf-grenoble.fr/~parisse/giac/doc/en/cascmd_en/cascmd_en.html
// https://www.haskell.org/onlinereport/haskell2010/haskellch9.html#x16-1720009.1

/*
 DICTIONARY
 aka Association in Wolfram, Dictionary in Python and Swift, Record in Maple,
 Map Containers in mathlab, Map in JavaScript
 Dictionary("field1", "value1", "field2", "value2"...)
 Need a new atomic 'dict' MathJSON type?
  {{name: 'dict',"field1": "value1", "field2": "value2"}}
*/

// LISTS
// https://www.mathworks.com/help/referencelist.html?type=function&listtype=cat&category=&blocktype=&capability=&s_tid=CRUX_lftnav

// == NestList ??
// Append (python) / Push
// Insert(i, x)
// Pop(): remove last, Pop(i): remove item at [i]

// set, delayed-set
// index
// Bind // replace  ( x-> 1)
// rule ->
// delayed-rule: :> (value of replacement is recalculated each time)
// set, set delayed
// join
// convert(expr, CONVERT_TO, OPTIONS) -- See Maple
// convert(expr, options), with options such as 'cos', 'sin, 'trig, 'exp', 'ln', 'latex', 'string', etc...)
// spread -> expand the elements of a list. If inside a list, insert the list into its parent

/**
 * Give a string like "f(x,y)" return, ["f", ["x", "y"]]
 */
export function parseFunctionSignature(
  s: string
): [id: string, args: string[] | undefined] {
  const m = s.match(/(.+)\((.*)\)/);
  if (!m) return [s, undefined];
  const id = m[1];
  const args = m[2].split(',').map((x) => x.trim());
  return [id, args];
}
