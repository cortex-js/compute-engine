import { MathJsonSymbol } from '../math-json';
import { cmp } from './boxed-expression/compare';
import type {
  BoxedDefinition,
  BoxedExpression,
  ComputeEngine,
  Scope,
} from './global-types';

/***
 * ### THEORY OF OPERATIONS
 *
 * The body of a `["Function"]` expression is a `["Block"]` expression,
 * which is scoped. The function arguments are declared in that scope as well.
 *
 * Some expressions with anonymous parameters (e.g. `["Add", "_", 1]`)
 * are rewritten to a `["Function"]` expression with anonymous parameters
 * (e.g. `["Function", ["Block", ["Add", "_", 1]], "_"]`).
 *
 *
 * #### DURING BOXING (in makeLambda())
 *
 * During the boxing/canonicalization phase of a function
 * (`["Function"]` expression or operator of expression):
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
 * 3/ The function parameters are set to the value of the arguments
 * 4/ The function body is evaluated in the context of the function scope
 * 5/ The context is swapped back to the current scope
 * 6/ The result of the function body is returned
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
    const c = cmp(a, b);
    if (c === '=') return 0;
    if (c === '<' || c === '<=') return -1;
    return 1;
  };
}

/**
 * Given an expression, rewrite it to a symbol or canonical Function form.
 *
 * - symbol (no change):
 *      "Sin"
 *     -> "Sin"
 *
 * - built-in function:
 *      ["BuiltinFunction", "Sin"]
 *     -> "Sin"
 *
 * - parenthesized expression:
 *      ["Delimiter", ["Add", "_", 1], "'()'"]
 *     -> ["Function", ["Block", ["Add", "_", 1]], "_"]
 *
 * - explicit parameters (adding a block to serve as a scope for the arguments):
 *      ["Function", ["Add", "x", 1], "x"]
 *      -> ["Function", ["Block", ["Add", "x", 1]], "x"]
 *
 *
 * - single anonymous parameters:
 *      ["Add", "_", 1]
 *      -> ["Function", ["Block", ["Add", "_", 1]], "_"]
 *
 * - multiple anonymous parameters:
 *      ["Add", "_1", "_2"]
 *      -> ["Function", ["Block", ["Add", "_1", "_2"]], "_1", "_2"]
 *
 *
 */
export function canonicalFunctionLiteral(
  expr: BoxedExpression | undefined
): BoxedExpression | undefined {
  if (!expr) return undefined;

  //
  // 1/ Canonical function literal
  //
  if (expr.operator === 'Function' && expr.isCanonical) return expr;

  //
  // 2/ If a symbol, e.g. "Sin", return unchanged
  //    When evaluating, the type of the symbol need to be checked to
  //    make sure it's a function
  //
  if (expr.symbol) return expr;

  //
  // 3/ `BuiltinFunction`, e.g. ["BuiltinFunction", "Sin"]
  //    This operator is just a "tag" indicating the nature of the
  //    symbol.
  //
  if (expr.operator === 'BuiltinFunction') return expr.op1;

  //
  // 4/ Parenthesized expression, e.g. ["Delimiter", ["Sin", "_"], "'()'"]
  //
  if (expr.operator === 'Delimiter') {
    // If the expression is a sequence, we need to extract the first
    // element
    if (expr.op1.operator === 'Sequence') {
      if (expr.op1.nops === 1) {
        expr = expr.op1;
      } else {
        return canonicalFunctionLiteral(
          expr.engine._fn('Block', expr.op1.ops!, { canonical: false })
        );
      }
    }

    return canonicalFunctionLiteral(expr.op1);
  }

  //
  // 5/ Function expression
  //
  // If this is a function literal, split the body and the parameters
  // For example, `["Function", ["Add", "x", 1], "x"]`
  if (expr.operator === 'Function')
    return canonicalFunctionLiteralArguments(expr.engine, expr.ops!);

  //
  // 6/ Shorthand function literal,
  // e.g. `["Add", "_", 1]` or `["Add", "x", 1]`
  //
  if (expr.operator) {
    console.assert(expr.operator !== 'Function');

    const ce = expr.engine;
    // Replace '_' with '_1'
    let body = expr.subs({ _: '_1' });

    // We need to extract the wildcards from the body. The wildcards can
    // be `_`, `_1`, `_2`, etc.
    let i = 1;
    let params: BoxedExpression[] = [];
    while (i < 10) {
      if (body.has(`_${i}`))
        params.push(body.engine.symbol(`_${i}`, { canonical: false }));
      i++;
    }

    if (params.length === 0) {
      // There are no wildcards

      // Check if we have some unknowns
      // We'll need the canonical form of the expression, so we'll create a block if necessary
      if (body.operator !== 'Block') body = ce.function('Block', [body]);
      else body = body.canonical;
      const unknowns = body.unknowns;
      if (unknowns.length > 0) {
        params = unknowns.map((x) => ce.symbol(x, { canonical: false }));
        // Note: we assume the order of parameters is the order in
        // which they appear in the expression.
      }
    }

    return canonicalFunctionLiteralArguments(ce, [body, ...params]);
  }

  return undefined;
}

/** Assuming that ops has the following form:
 * - body
 * - ...params
 * return a canonical function literal (["Function", body, ...params]) where
 * body is potentially wrapped in a Block expression and the arguments are
 * declared in the scope of the body.
 */
export function canonicalFunctionLiteralArguments(
  ce: ComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression | undefined {
  if (ops.length === 0) return undefined;

  // If the body is not scoped, we need to create a new scope
  // and add the parameters to it.
  // `["Function", ["Add", "_", 1], "_"]`
  // becomes `["Function", ["Block", ["Add", "_", 1]], "_"]`
  const block =
    ops[0].operator === 'Block'
      ? ops[0].canonical
      : ce.function('Block', [ops[0]]);

  const params = ops!
    .slice(1)
    .map((x) => (x.symbol ? x : ce.error('expected-a-symbol', x.toString())));

  console.assert(block.isScoped);
  // Declare the arguments in the scope of the body of the function.
  for (const param of params) {
    // We only declare the parameters that are not already declared
    // in the scope of the body
    if (param.symbol && !block.localScope!.bindings.has(param.symbol)) {
      // @todo: we could use the signature to declare a more specific, non-inferred, type
      ce.declare(
        param.symbol,
        { inferred: true, type: 'unknown' },
        block.localScope
      );
    }
  }
  return ce._fn('Function', [block, ...params]);
}

/**
 * Given a function literal (including possibly a shorthand function
 * literal), return the body and the parameters.
 *
 */
function splitFunctionLiteral(
  body: BoxedExpression
): [body: BoxedExpression, ...params: BoxedExpression[]] {
  //
  // 2/ This is a shorthand function literal, e.g. `["Add", "_", 1]`
  // We need to extract the wildcards from the body. The wildcards can
  // be `_`, `_1`, `_2`, etc.

  // Replace '_' with '_1'
  body = body.subs({ _: '_1' });

  let i = 1;
  const params: BoxedExpression[] = [];
  while (i < 10) {
    if (body.has(`_${i}`))
      params.push(body.engine.symbol(`_${i}`, { canonical: false }));

    i++;
  }

  return [body, ...params];
}

/**
 *
 * @param f
 * @returns
 */
function evaluateFunctionLiteral(f: BoxedExpression): BoxedExpression {
  console.assert(f.isCanonical);
  return f;
}

/**
 * Apply arguments to an expression which is either:
 * - a `["Function"]` expression
 * - the symbol for a function, e.g. `Sin`.
 */
export function apply(
  fn: BoxedExpression,
  args: ReadonlyArray<BoxedExpression>
): BoxedExpression {
  const result = makeLambda(fn)?.(args);
  if (result) return result;
  return fn.engine.function('Apply', [fn, ...args]);
}

/**
 * If `expr is a function literal (`["Function"]` expression), return a
 * JavaScript function that can be called with arguments.
 */

function makeLambda(
  expr: BoxedExpression
): (params: ReadonlyArray<BoxedExpression>) => BoxedExpression | undefined {
  const ce = expr.engine;

  // If the expression is a symbol, interpret it as an operator
  if (expr.symbol) return (args) => ce.function(expr.symbol!, args).evaluate();

  const canonicalExpr = canonicalFunctionLiteral(expr);
  if (!canonicalExpr) throw new Error('Invalid function literal');

  expr = canonicalExpr;

  console.assert(expr.operator === 'Function');
  console.assert(expr.isCanonical);

  //
  // No arguments, we just need to evaluate the body
  //
  console.assert(expr.ops);
  if (expr.ops!.length === 1) {
    console.assert(expr.ops![0]);
    return () => expr.ops![0].evaluate();
  }

  const [body, ...params] = expr.ops!;

  console.assert(body.isScoped);

  return (args) => {
    //
    // 1/ If there are more arguments than expected, exit
    //
    if (args.length > params.length) {
      throw new Error(
        `Too many arguments for function "${expr.toString()}": expected ${params.length}, got ${args.length}`
      );
    }

    //
    // 2/ If an argument is invalid, exit
    //
    if (ce.strict && !args.every((x) => x.isValid)) return undefined;

    //
    // 3/ If there are fewer arguments than expected, curry the function
    //
    if (args.length < params.length) {
      // Generate unique parameter names to avoid collisions
      const allSymbols = new Set([
        ...body.symbols,
        ...params.map((p) => p.symbol),
      ]);
      const extras = params.slice(args.length).map((_, i) => {
        let name = `_${i + 1}`;
        let counter = 0;
        while (allSymbols.has(name)) {
          name = `_${i + 1}_${counter++}`;
        }
        allSymbols.add(name);
        return ce.symbol(name, { canonical: false });
      });

      // Create substitution map for remaining parameters
      const substitutions = Object.fromEntries(
        params.slice(args.length).map((param, i) => [param.symbol!, extras[i]])
      );

      // Apply known arguments and substitute remaining parameters
      const newBody = body
        .evaluate({
          withArguments: Object.fromEntries(
            params.slice(0, args.length).map((key, i) => [key.symbol, args[i]])
          ),
        })
        .subs(substitutions);

      return ce.function('Function', [newBody, ...extras]);
    }

    //
    // 4/ Evaluate the arguments, in the current scope
    // (we don't want the arguments to be bound to the function scope)
    // and pass them to evaluate()
    //

    // Note: evaluate will switch to the function scope
    const result = body.evaluate({
      withArguments: Object.fromEntries(
        params.map((key, i) => [key.symbol, args[i].evaluate()])
      ),
    });

    return result.isValid ? result : undefined;
  };
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
): (xs: ReadonlyArray<BoxedExpression>) => BoxedExpression | undefined {
  return (
    makeLambda(fn) ??
    ((xs) => fn.engine.function('Apply', [fn, ...xs]).evaluate())
  );
}

/**
 * Use `applicableN1()` when the function is known to be a function with a
 * single real argument that returns a real value.
 *
 * Unlike `apply()`, `applicableN1()` returns a function that can be called
 * with an argument.
 *
 */
export function applicableN1(fn: BoxedExpression): (x: number) => number {
  const lambda = makeLambda(fn);
  const ce = fn.engine;

  if (lambda) return (x) => lambda([ce.number(x)])?.re ?? NaN;

  return (x) => ce.function('Apply', [fn, ce.number(x)]).evaluate().re;
}

/**
 * Given a string like "f(x,y)" return, ["f", ["x", "y"]]
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

/** Lookup a definition matching a symbol in a lexical scope chain */
export function lookup(
  id: MathJsonSymbol,
  scope: Scope
): undefined | BoxedDefinition {
  console.assert(typeof id === 'string' && id.length > 0);
  let currentScope: Scope | null = scope;
  while (currentScope) {
    const def = currentScope.bindings.get(id);
    if (def) return def;

    currentScope = currentScope.parent;
  }
  return undefined;
}
