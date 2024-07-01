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
 *
 */
export function canonicalFunctionExpression(
  body: BoxedExpression,
  args: BoxedExpression[] = []
): [body: BoxedExpression, ...params: string[]] | undefined {
  // The body of a Function expression could use a combination of named
  // parameters and wildcards. For example:
  // ["Function", ["Add", "x", "_2", "_1"], "x"]
  // That needs to be transformed to:
  // ["Function", ["Add", "x", "_2", "x"], "x", "_2"]
  const params = args.map((x, i) => {
    if (!x.symbol || x.symbol === 'Nothing') return `_${i + 1}`;
    return x.symbol;
  });
  let unknowns = body.unknowns;
  if (unknowns.includes('_')) {
    body = body.subs({ _: '_1' });
    unknowns = body.unknowns;
  }
  let count = params.length;
  // Add any anonymous parameters that are not already in the list
  for (const unknown of unknowns) {
    if (unknown.startsWith('_')) {
      const n = Number(unknown.slice(1));
      if (n <= params.length) body = body.subs({ [unknown]: params[n - 1] });
      if (n > count) count = n;
    }
  }

  for (let i = params.length; i < count; i++) params.push(`_${i + 1}`);

  // Remove any trailing anonymous parameters that are not used
  // For example in `() -> 2`. An implicit Nothing -> _1 parameter. We need to
  // remove it now.
  let i = count;
  while (i > 0) {
    if (params[i - 1] === `_${i}`) {
      if (!unknowns.includes(`_${i}`)) params.pop();
    } else break;
    i--;
  }

  return [body, ...params];
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

  // Turn the expression into a canonical Function expression
  // For example, ["Add", "_", 1] -> ["Function", ["Add", "_", 1], "_"]
  let canonicalFn;
  if (expr.head === 'Function') {
    canonicalFn = canonicalFunctionExpression(expr.op1, expr.ops!.slice(1));
  } else canonicalFn = canonicalFunctionExpression(expr);
  if (!canonicalFn) return undefined;
  const [body, ...params] = canonicalFn;

  // Create a scope for the arguments and locals
  ce.pushScope();
  // Declare some "placeholders" for the parameters.
  // This is to avoid having the arguments bound to an id in a parent scope
  // with coincidentally the same name as the parameter.
  for (const param of params)
    ce.declare(param, { inferred: true, domain: undefined });
  const fn = body.canonical;

  fn.bind();
  ce.popScope();

  const fnScope = fn.scope!;

  // The function may have some arguments, but the body of the function does
  // not reference them
  if (!fnScope) return () => fn.N() ?? fn.evaluate();

  if (params.length === 0) {
    return () => {
      const context = ce.swapScope(fnScope);
      ce.resetContext();
      const result = fn.N() ?? fn.evaluate();
      ce.swapScope(context);
      return result;
    };
  }

  return (args) => {
    // If there are more arguments than expected, exit
    if (args.length > params.length) return undefined;

    // If an argument is invalid, exit
    if (ce.strict && !args.every((x) => x.isValid)) return undefined;

    // If there are fewer arguments than expected, curry the function
    if (args.length < params.length) {
      // const sub = Object.fromEntries(
      //   params.slice(args.length).map((x, i) => [x, ce.symbol(`_${i + 1}`)])
      // );
      const extras = params
        .slice(args.length)
        .map((x, i) => ce.symbol(`_${i + 1}`));
      const newBody = apply(ce.box(['Function', body, ...params]), [
        ...args,
        ...extras,
      ]).evaluate();
      return ce.box(['Function', newBody]);
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
