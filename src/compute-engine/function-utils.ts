import { inferDomain } from './domain-utils';
import { BoxedExpression } from './public';

/**
 * From an expression, create an iterator that can be used
 * to enumerate values.
 *
 * `expr` can be a collection, a function, an expression, a string.
 *
 * - ["Range", 5]
 * - "'hello world'"
 *
 */
export function iterable(
  expr: BoxedExpression
): Iterator<BoxedExpression> | undefined {
  const h = expr.symbol;

  // Is it a function expresson with a definition that includes an iterator?
  // e.g. iter(["Range", 5])
  if (h !== null) {
    const def = expr.engine.lookupFunction(h);
    // Note that if there is an at() handler, there is always
    // a default iterator
    if (def?.iterator) return def.iterator(expr);
  }

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
 * indexable(expr) return function with one argument.
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

  const lambda = makeLambda(expr);
  if (lambda) return (index) => lambda([expr.engine.number(index)]);

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

  return undefined;
}

/**
 * From an expression, return a predicate function, which can be used to filter.
 */
export function predicate(
  _expr: BoxedExpression
): (...args: BoxedExpression[]) => boolean {
  return () => false;
}

/**
 * From an expression, create an ordering function, which can be used to sort.
 */
export function order(
  _expr: BoxedExpression
): (a: BoxedExpression, b: BoxedExpression) => -1 | 0 | 1 {
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
 * Turn a Function or a Lambda expression into a canonical expression
 * with anonymous parameters (`_n` parameters).
 */

function makeLambda(
  expr: BoxedExpression
): ((args: BoxedExpression[]) => BoxedExpression) | undefined {
  const [body, paramCount] = normalizeLambda(expr);
  if (!body) return undefined;

  if (paramCount === 0) return () => body!.evaluate();
  const ce = expr.engine;
  if (paramCount === 1)
    return (args) => {
      ce.pushScope();
      ce.declare('_1', { value: args[0], domain: inferDomain(args[0]) });
      const result = body!.evaluate();
      ce.popScope();
      return result;
    };

  return (args) => {
    ce.pushScope();
    for (let i = 0; i < paramCount; i++) {
      const value = args[i];
      ce.declare(`_${i + 1}`, { value, domain: inferDomain(value) });
    }
    const result = body!.evaluate();
    ce.popScope();
    return result;
  };
}

/**
 * Given an expression, rewrite it to anonymous parameters (`_n` parameters).
 * If there is a single free variable, it is replaced by `_1`.
 *
 *
 * - implicit arg (free var): ["Function", "x"] -> ["x", ["x"]]  (body, args)
 * - explicit arg: ["Function", "x", "x"] -> ["x", ["x"]]  (body, args)
 * - ["_"] -> ["_1", ["_1"]]  // single implicit arg
 * - ["_1"] -> ["_1", ["_1"]]  // implicit arg
 *
 */
function normalizeLambda(
  expr: BoxedExpression
): [body: BoxedExpression | undefined, paramCount: number] {
  expr = expr.evaluate();

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
  if (expr.head === 'Function') {
    // e.g. Function(["Add", "x", 1], "x")
    const [body, ...params] = expr.ops!;
    if (params.length === 0) return body.subs({ _: '_1' });

    const subs = {};
    let n = 1;
    for (const param of params)
      if (param.symbol) subs[param.symbol] = `_${n++}`;
    return body.subs(subs);
  }

  //
  // Not a `["Function"]` expression, maybe an expression with anonymous parameters.
  //

  // Could be a function name, i.e. "Sin", "Cos", etc...
  // or an "operator" a function of a function, i.e. ["f", "g"] or
  // ["InverseFunction", "Sin"]
  return fv.length === 0 ? undefined : expr;
}

/**
 * Return a lambda function, assuming a scoped environment has been
 * created and there is a single numeric argument
 */
export function makeScopedLambda1(
  expr: BoxedExpression
): ((arg: number) => number) | undefined {
  const body = normalizeLambda(expr);
  if (!body) return undefined;
  const ce = expr.engine;
  return (arg) => {
    ce.assign('_1', arg);
    return body!.N().valueOf() as number;
  };
}

/** Apply arguments to an expression.
 *
 * If the expression includes
 * anonymous parameters `_`, `_1`, etc.. they are substituted before the expression evaluated. Otherwise
 * the expression is just evaluated.
 */
export function apply(
  fn: BoxedExpression,
  args: BoxedExpression[]
): BoxedExpression {
  const lambda = makeLambda(fn);
  if (lambda) return lambda(args);

  return fn.engine._fn(fn, args);
}

/**
 * Given an expression such as:
 * - ["Function", ["+", 1, "x"], "x"]
 * - ["Function", ["Divide", "_", 2]]
 * - ["Multiply, "_", 3]
 * - ["Add, "_1", "_2"]
 * - "Sin"
 *
 * return a function that can be called with arguments.
 */
export function applicable(
  fn: BoxedExpression
): (args: BoxedExpression[]) => BoxedExpression {
  return (
    makeLambda(fn) ?? ((args) => fn.engine._fn(fn.evaluate(), args).evaluate())
  );
}

/**
 * Use applicableN when the function is known to be a function of a single
 * variable and the argument is a number.
 *
 * Unlike "apply", applicable returns a function  that can be called
 * with an argument.
 *
 */
export function applicableN(fn: BoxedExpression): (x: number) => number {
  const ce = fn.engine;

  const lambda = makeLambda(fn);
  if (lambda) return (x) => lambda([ce.number(x)]).valueOf() as number;

  return (x) =>
    ce
      ._fn(fn.evaluate(), [ce.number(x)])
      .evaluate()
      .valueOf() as number;
}

export function scopedApplicableN(fn: BoxedExpression): (x: number) => number {
  const ce = fn.engine;

  const lambda = makeLambda(fn);
  if (lambda) return (x) => lambda([ce.number(x)]).valueOf() as number;

  return (x) =>
    ce
      ._fn(fn.evaluate(), [ce.number(x)])
      .evaluate()
      .valueOf() as number;
}

// xcas/gias https://www-fourier.ujf-grenoble.fr/~parisse/giac/doc/en/cascmd_en/cascmd_en.html
// https://www.haskell.org/onlinereport/haskell2010/haskellch9.html#x16-1720009.1
// length(expr, depth:integer) (for a list, an expression, etc..)
// shape
// length
// depth

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
// N
// spread -> expand the elements of a list. If inside a list, insert the list into its parent
