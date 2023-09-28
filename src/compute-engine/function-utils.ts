import { BoxedExpression } from './public';

/**
 * From an expression, create an iterator that can be used
 * to enumerate values.
 *
 * `expr` can be a collection, a function, an expression, a string.
 *
 * - ["Range", 5]
 * - ["List", 1, 2, 3]
 * - "'hello world'"
 *
 */
export function iterable(
  expr: BoxedExpression
): Iterator<BoxedExpression> | undefined {
  // Is it a function expresson with a definition that includes an iterator?
  // e.g. ["Range", 5]
  // Note that if there is an at() handler, there is always
  // at least a default iterator
  const def = expr.functionDefinition;
  if (def?.iterator) return def.iterator(expr);

  //
  // String iterator
  //
  const s = expr.string;
  if (s !== null) {
    if (s.length === 0)
      return { next: () => ({ done: true, value: undefined }) };
    let i = 0;
    return {
      next: () => ({
        value: expr.engine.string(s.charAt(i++)),
        done: i > s.length,
      }),
    };
  }

  return undefined;
}

/**
 * indexable(expr) return a JS function with one argument.
 *
 * Evaluate expr.
 * If expr is indexable function (def with at handler), return handler.
 * Otherwise, call makeLambda, then return function that set scope
 * with one arg, then evaluate result of makeLambda.
 */

export function indexable(
  expr: BoxedExpression
): ((index: number) => BoxedExpression | undefined) | undefined {
  expr = expr.evaluate();

  // If the function expression is indexable (it has an at() handler)
  // return the at() handler, bound to this expression.
  if (expr.functionDefinition?.at) {
    const at = expr.functionDefinition.at;
    return (index) => at(expr, index);
  }

  //
  // String at
  //
  const s = expr.string;
  if (s !== null) {
    return (index) => {
      const c = s.charAt(index);
      if (c === undefined) return expr.engine.symbol('Nothing');
      return expr.engine.string(c);
    };
  }

  // Expressions that don't have an at() handler, have the
  // argument applied to them.
  const lambda = makeLambda(expr);
  if (lambda) return (index) => lambda([expr.engine.number(index)]);

  return undefined;
}

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
  //  - N(D) -> ND()
  //  - N(Integrate) -> NIntegrate()
  //
  if (expr.head === 'N' && typeof expr.op1.head === 'string') {
    const newHead = { D: 'ND', Integrate: 'NIntegrate' }[expr.op1.head];
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

  const unknowns = expr.unknowns;
  let count = unknowns.includes('_') ? 1 : 0;
  for (const unknown of unknowns) {
    if (unknown.startsWith('_')) {
      const n = Number(unknown.slice(1));
      if (n > count) count = n;
    }
  }

  const ce = expr.engine;
  ce.pushScope();
  const result = ce._fn('Function', [
    expr,
    ...Array.from({ length: count }, (_, i) => ce.symbol(`_${i + 1}`)),
  ]);
  ce.popScope();
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
): ((params: BoxedExpression[]) => BoxedExpression | undefined) | undefined {
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

  const fn = canonicalFunctionExpression(expr);
  if (!fn) return undefined;
  console.assert(fn.head === 'Function');
  ce.pushScope();
  const body = fn.op1.canonical;
  ce.popScope();

  // Extract the arguments from the function definition ("x", "y")
  const args = fn.ops!.slice(1).map((x) => x.symbol ?? 'Nothing');

  if (args.length === 0) return () => body.N() ?? body.evaluate();

  const fnScope = body.scope;
  return (params) => {
    const context = ce.swapScope(fnScope);

    let i = 0;
    for (const arg of args) ce.assign(arg, params[i++]);
    if (params[0]) ce.assign('_', params[0]);

    const result = body.N() ?? body.evaluate();

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
  args: BoxedExpression[]
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
  if (lambda)
    return (x) => (lambda([ce.number(x)])?.valueOf() as number) ?? NaN;

  return (x) =>
    ce
      ._fn(fn.evaluate(), [ce.number(x)])
      .evaluate()
      .valueOf() as number;
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
