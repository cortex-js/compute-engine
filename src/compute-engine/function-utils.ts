import { MathJsonSymbol } from '../math-json.js';
import { cmp } from './boxed-expression/compare.js';
import type {
  BoxedDefinition,
  EvaluateOptions,
  Expression,
  FunctionInterface,
  IComputeEngine as ComputeEngine,
  Scope,
} from './global-types.js';
import {
  isSymbol,
  isFunction,
  isString,
  isTensor,
  sym,
} from './boxed-expression/type-guards.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
} from './boxed-expression/function-literal.js';
import type { Type } from '../common/type/types.js';

// Lazy reference to `validateArguments` (from `boxed-expression/validate.ts`).
// A static import would create a cycle: `validate.ts → utils.ts →
// boxed-operator-definition.ts → function-utils.ts`. Injected once by
// `boxed-expression/init-lazy-refs.ts` at engine load. The type is written
// inline (not `import type`) so madge does not detect a type-only cycle.
type ValidateArgumentsFn = (
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>,
  signature: Type,
  lazy?: boolean,
  threadable?: boolean,
  inferredBefore?: ReadonlySet<string>
) => ReadonlyArray<Expression> | null;

let _validateArguments: ValidateArgumentsFn | undefined;
export function _setValidateArguments(fn: ValidateArgumentsFn): void {
  _validateArguments = fn;
}

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
 * #### DURING CANONICALIZATION (in canonicalFunctionLiteralArguments())
 *
 * 1/ If not a `["Function"]` expression, the expression is rewritten
 *    to a `["Function"]` expression with anonymous parameters
 * 2/ A `Block` scope is created
 * 3/ The function parameters are declared in the Block's scope
 * 4/ The function body is canonicalized in the context of the scope.
 *    The Block's localScope captures the defining scope as its parent.
 *
 *
 * #### DURING EVALUATION (executing the result of makeLambda())
 *
 * 1/ The arguments are evaluated in the **calling** scope
 * 2/ A fresh scope is created per call, with parent = the **defining**
 *    scope (body.localScope.parent), giving true lexical scoping
 * 3/ The function parameters are declared in the fresh scope
 * 4/ body.localScope is temporarily re-parented to chain through the
 *    fresh scope: bigOpScope → bodyScope → freshScope → capturedScope.
 *    Param bindings in bodyScope (stale, from canonicalization) are
 *    temporarily hidden so they don't shadow freshScope's values.
 *    This lets nested scoped expressions (Sum, Product) find params
 *    by walking up their static scope chain.
 * 5/ The function body is evaluated in the context of the fresh scope
 * 6/ If the result contains Function literals, they are rebound to
 *    close over the fresh scope (closure capture)
 * 7/ The fresh scope is discarded; body.localScope.parent is restored
 * 8/ The result is returned
 *
 */

/**
 * From an expression, return a predicate function, which can be used to filter.
 */
export function predicate(
  _expr: Expression
): (...args: Expression[]) => boolean {
  // @todo
  return () => false;
}

/**
 * From an expression, create an ordering function, which can be used to sort.
 */
export function order(
  _expr: Expression
): (a: Expression, b: Expression) => -1 | 0 | 1 {
  // @todo
  //
  // Default comparator
  //
  return (a: Expression, b: Expression) => {
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
  expr: Expression | undefined
): Expression | undefined {
  if (!expr) return undefined;

  //
  // 0/ A string literal is never a function. Without this guard a string
  //    falls through to the shorthand path below and becomes a constant
  //    nullary function `() ↦ "s"`, so e.g. `Map([1,2,3], "nf")` would map to
  //    `["nf","nf","nf"]` instead of being rejected.
  //
  if (isString(expr)) return undefined;

  //
  // 1/ Canonical function literal
  //
  if (expr.operator === 'Function' && expr.isCanonical) return expr;

  //
  // 2/ If a symbol, e.g. "Sin", return unchanged
  //    When evaluating, the type of the symbol need to be checked to
  //    make sure it's a function
  //
  if (isSymbol(expr)) return expr;

  //
  // 3/ `BuiltinFunction`, e.g. ["BuiltinFunction", "Sin"]
  //    This operator is just a "tag" indicating the nature of the
  //    symbol.
  //
  if (isFunction(expr, 'BuiltinFunction')) return expr.op1;

  //
  // 4/ Parenthesized expression, e.g. ["Delimiter", ["Sin", "_"], "'()'"]
  //
  if (isFunction(expr, 'Delimiter')) {
    // If the expression is a sequence, we need to extract the first
    // element
    const exprOp1 = expr.op1;
    if (isFunction(exprOp1, 'Sequence')) {
      if (exprOp1.nops === 1) {
        expr = exprOp1;
      } else {
        return canonicalFunctionLiteral(
          expr.engine._fn('Block', exprOp1.ops, { canonical: false })
        );
      }
    }

    return canonicalFunctionLiteral(isFunction(expr) ? expr.op1 : undefined);
  }

  //
  // 5/ Function expression
  //
  // If this is a function literal, split the body and the parameters
  // For example, `["Function", ["Add", "x", 1], "x"]`
  if (isFunction(expr, 'Function'))
    return canonicalFunctionLiteralArguments(expr.engine, expr.ops);

  //
  // 6/ Shorthand function literal,
  // e.g. `["Add", "_", 1]` or `["Add", "x", 1]`
  //
  console.assert(expr.operator !== 'Function');

  const ce = expr.engine;
  // Replace '_' with '_1'
  let body = expr.subs({ _: '_1' });

  // We need to extract the wildcards from the body. The wildcards can
  // be `_`, `_1`, `_2`, etc.
  let i = 1;
  let params: Expression[] = [];
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

/** Assuming that ops has the following form:
 * - body
 * - ...params
 * return a canonical function literal (["Function", body, ...params]) where
 * body is potentially wrapped in a Block expression and the arguments are
 * declared in the scope of the body.
 */
export function canonicalFunctionLiteralArguments(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (ops.length === 0) return undefined;

  // Parameters: a bare symbol (inferred type) or an annotated parameter
  // `["Typed", symbol, type]`. Anything else is an error. An annotated
  // parameter keeps its `Typed` wrapper, normalized so the type operand is a
  // string (mirroring how `Declare` keeps its type operand raw).
  const params = ops.slice(1).map((x) => {
    if (isSymbol(x)) return x;
    if (isFunction(x, 'Typed') && isSymbol(x.op1))
      return normalizeTypedParameter(ce, x);
    return ce.error('expected-a-symbol', x.toString());
  });

  // Collect the declared types of annotated parameters so they are visible
  // during body canonicalization (the §6.1 pre-declare mechanism).
  const shadowNames: string[] = [];
  const shadowTypes = new Map<string, Type>();
  for (const param of params) {
    const name = functionLiteralParameterName(param);
    if (!name) continue;
    shadowNames.push(name);
    const t = functionLiteralParameterType(param);
    if (t !== undefined) shadowTypes.set(name, t);
  }

  // A body-slot return-type ascription `["Typed", body, type]` is normalized
  // per §4.2: the `Typed` wrapper moves INSIDE the Block, wrapping the last
  // statement, so the body slot stays a scoped Block.
  let bodyOp = ops[0];
  let returnTypeOp: Expression | undefined;
  if (isFunction(bodyOp, 'Typed')) {
    returnTypeOp = normalizeTypeOperand(ce, bodyOp.op2);
    bodyOp = bodyOp.op1;
  }

  // If the body is not scoped, we need to create a new scope
  // and add the parameters to it.
  // `["Function", ["Add", "_", 1], "_"]`
  // becomes `["Function", ["Block", ["Add", "_", 1]], "_"]`
  //
  // The body is canonicalized here. While it is, the parameter names are pushed
  // onto the engine's shadowed-parameter stack so a parameter named like a
  // constant (`i`, `e`, ...) resolves to the parameter, not the constant —
  // `Function(2·i, i)` stays `(i) ↦ 2·i` instead of becoming `(i) ↦ 2i`. The
  // shadowing only blocks the constant substitution; the parameter is still
  // auto-declared as an ordinary local in the body scope, so the closure-capture
  // machinery is unaffected. Annotated parameters additionally carry their
  // declared type so the auto-declaration uses that type (see §6.1).
  ce._pushShadowedParameters(
    shadowNames,
    shadowTypes.size > 0 ? shadowTypes : undefined
  );
  let block: Expression;
  try {
    if (returnTypeOp === undefined) {
      block =
        bodyOp.operator === 'Block'
          ? bodyOp.canonical
          : ce.function('Block', [bodyOp]);
    } else {
      // Wrap the body Block's last statement in the return-type ascription.
      const statements: Expression[] = isFunction(bodyOp, 'Block')
        ? [...bodyOp.ops]
        : [bodyOp];
      if (statements.length === 0) statements.push(ce.Nothing);
      const lastIdx = statements.length - 1;
      statements[lastIdx] = ce._fn(
        'Typed',
        [statements[lastIdx], returnTypeOp],
        { canonical: false }
      );
      block = ce.function('Block', statements);
    }
  } finally {
    ce._popShadowedParameters();
  }

  console.assert(block.isScoped);
  // Declare the arguments in the scope of the body of the function, for any
  // parameter that was not already auto-declared during body canonicalization
  // (e.g. a parameter unreferenced in the body). Annotated parameters get
  // their declared type, non-inferred.
  for (const param of params) {
    const name = functionLiteralParameterName(param);
    if (!name || block.localScope!.bindings.has(name)) continue;
    const t = functionLiteralParameterType(param);
    if (t !== undefined)
      ce.declare(name, { inferred: false, type: t }, block.localScope);
    else
      ce.declare(name, { inferred: true, type: 'unknown' }, block.localScope);
  }
  return ce._fn('Function', [block, ...params]);
}

/** Normalize a `Typed` type operand (a string literal or a type-name symbol)
 * to a string literal, so a type-name symbol such as `real` is not
 * auto-declared as a variable. */
function normalizeTypeOperand(
  ce: ComputeEngine,
  t: Expression | undefined
): Expression {
  if (!t) return ce.string('unknown');
  const s = isString(t) ? t.string : sym(t);
  return s !== undefined ? ce.string(s) : t;
}

/** Rebuild an annotated parameter `["Typed", symbol, type]` with its type
 * operand normalized to a string literal. */
function normalizeTypedParameter(
  ce: ComputeEngine,
  param: Expression
): Expression {
  if (!isFunction(param)) return param;
  return ce._fn('Typed', [param.op1, normalizeTypeOperand(ce, param.op2)], {
    canonical: false,
  });
}

/**
 * The declared type to bind an annotated parameter's fresh-scope binding with
 * (`inferred: false`), or `undefined` to fall back to the historical inferred
 * binding (`{ value, inferred: true }`).
 *
 * Only strict mode attaches a declared type — that is where step 4/step 3
 * validation runs, so a provably-wrong value has already been rejected. The
 * value is nonetheless bound under the declared type only when it is provably
 * compatible: an `unknown`/`any`/symbolic value passes validation as "not
 * provably wrong", but binding it under a narrower fixed type would trip the
 * value-definition covariant check (`value.type.matches(declaredType)`), which
 * throws. Falling back to inferred there keeps the historical symbolic
 * beta-reduction (e.g. an undeclared-symbol argument).
 */
function typedBinding(
  ce: ComputeEngine,
  param: Expression,
  value: Expression
): Type | undefined {
  if (!ce.strict) return undefined;
  const t = functionLiteralParameterType(param);
  if (t === undefined) return undefined;
  return value.type.matches(t) ? t : undefined;
}

/**
 * Apply arguments to an expression which is either:
 * - a `["Function"]` expression
 * - the symbol for a function, e.g. `Sin`.
 */
export function apply(
  fn: Expression,
  args: ReadonlyArray<Expression>,
  options?: Partial<EvaluateOptions>
): Expression {
  // An unresolved symbolic derivative applied to an argument must stay
  // symbolic. `derivative()` represents the derivative of a function with no
  // known derivative as the self-applied lambda `Apply(Derivative(f, n), _)`.
  // Letting `makeLambda` beta-reduce and re-evaluate that body would
  // re-evaluate the inner `Derivative`, regenerating the same lambda and
  // recursing forever (stack overflow). Instead, substitute the argument
  // structurally — swap the placeholder operand for the actual argument — so
  // `Apply(Derivative(f, n), 0)` is returned unevaluated.
  if (isFunction(fn, 'Derivative')) {
    return fn.engine._fn('Apply', [fn, ...args]);
  }

  if (isFunction(fn, 'Apply') && fn.op1?.operator === 'Derivative') {
    return fn.engine._fn('Apply', [fn.op1, ...args]);
  }

  const result = makeLambda(fn)?.(args, options);
  if (result) return result;
  return fn.engine.function('Apply', [fn, ...args]);
}

/**
 * Evaluate a sequence of statements, handling Return/Break/Continue.
 *
 * Used by both:
 * - `evaluateBlock` in control-structures.ts (Block evaluation handler)
 * - `makeLambda` below (iterates body.ops directly instead of calling
 *   body.evaluate(), because body is a Block whose _localScope has param
 *   bindings from canonicalization — declared with type 'unknown' but no
 *   value. If body.evaluate() were called, Block would push its _localScope
 *   as the eval context, and lookup() would find those stale bindings
 *   before reaching the freshScope where actual param values live.)
 */
export function evaluateStatements(
  ce: ComputeEngine,
  ops: Iterable<Expression>
): Expression {
  let result: Expression = ce.Nothing;
  for (const op of ops) {
    // Evaluate the statement. `Break`/`Continue` are inert registered
    // operators and `Return` is unregistered, so a literal control-flow
    // statement evaluates to itself with its operand evaluated.
    result = op.evaluate();
    // Short-circuit on a control-flow result — whether the statement was a
    // literal `Break`/`Continue`/`Return` or *evaluated to* one (e.g.
    // `If(cond, Break)`). The control-flow expression itself is the block's
    // value, so it propagates through nested blocks up to the enclosing
    // `Loop` (which consumes `Break`/`Continue`) or function application
    // (which unwraps `Return` — see `unwrapReturn`).
    const h = result.operator;
    if (h === 'Return' || h === 'Break' || h === 'Continue') break;
  }
  return result;
}

/**
 * Unwrap a `["Return", value]` expression to its value at a function
 * application boundary. `evaluateStatements` propagates `Return` wrapped so
 * that it can escape nested blocks and loops; the function boundary is where
 * it is consumed.
 */
function unwrapReturn(ce: ComputeEngine, expr: Expression): Expression {
  if (expr.operator === 'Return' && isFunction(expr))
    return expr.ops.length > 0 ? expr.op1 : ce.Nothing;
  return expr;
}

/**
 * Temporarily remove stale canonicalization bindings from bodyScope so they
 * don't shadow the freshScope values during scope chain lookup. Returns the
 * removed entries for restoration.
 *
 * Two kinds of bindings are hidden:
 * - the function's parameters (their call values live in freshScope);
 * - inferred, valueless bindings — auto-declared free variables and hoisted
 *   `Declare`/`Assign` block-locals (see `canonicalBlock`). These exist only
 *   as canonicalization bookkeeping: at evaluation time the `Declare`
 *   statement re-creates its local in the current (fresh) scope, and a
 *   nested scoped expression (an inner `Block`, a `Sum`) resolving through
 *   bodyScope must see that runtime binding, not the valueless stale one.
 *
 * Bindings that carry a value or an explicit type are left in place.
 */
function hideBodyScopeParams(
  bodyScope: Scope,
  paramNames: string[]
): Array<[string, BoxedDefinition]> {
  const hidden: Array<[string, BoxedDefinition]> = [];
  const params = new Set(paramNames.filter((n) => n));
  for (const [name, binding] of [...bodyScope.bindings]) {
    const stale =
      params.has(name) ||
      ('value' in binding &&
        binding.value.inferredType &&
        binding.value.value === undefined);
    if (stale) {
      hidden.push([name, binding]);
      bodyScope.bindings.delete(name);
    }
  }
  return hidden;
}

/** Restore param bindings removed by hideBodyScopeParams. */
function restoreBodyScopeParams(
  bodyScope: Scope,
  hidden: Array<[string, BoxedDefinition]>
): void {
  for (const [name, binding] of hidden) bodyScope.bindings.set(name, binding);
}

/**
 * If `expr` is a bare symbol bound to a user-defined function literal (an
 * operator definition created by `helper(x) = …`), return the underlying
 * `Function` literal so the function can escape its defining scope as a
 * first-class value. Otherwise return `expr` unchanged.
 *
 * Must be called while the defining call frame is still pushed, so the
 * operator definition is reachable via `lookupDefinition`.
 */
export function resolveEscapingLambda(
  ce: ComputeEngine,
  expr: Expression
): Expression {
  if (!isSymbol(expr)) return expr;
  const def = ce.lookupDefinition(expr.symbol);
  if (def && 'operator' in def) {
    const literal = (def.operator as { _lambdaLiteral?: Expression })
      ._lambdaLiteral;
    if (literal !== undefined) return literal;
  }
  return expr;
}

/**
 * Recursively walk `expr` and rebind any Function literals so their body
 * scopes close over `closureParent`. This handles Functions nested inside
 * List, Tuple, Pair, or any other compound expression.
 *
 * Example: given `List(Function(x+n), Function(x+2*n))` where n=5 lives
 * in `closureParent` (the outer call's fresh scope), both inner Functions
 * are rebound so their Block scopes have `parent = closureParent`, ensuring
 * they see n=5 even after the outer fresh scope is popped.
 *
 * Multi-level nesting (f returning g returning h) still works because each
 * evaluation of a Function triggers its own closure capture at that level.
 */
function captureClosures(
  ce: ComputeEngine,
  expr: Expression,
  closureParent: Scope
): Expression {
  if (expr.operator === 'Function' && isFunction(expr)) {
    const innerBlock = expr.op1;
    if (innerBlock && isFunction(innerBlock) && innerBlock.localScope) {
      // Only copy bindings for the inner function's own parameters.
      // Other entries (auto-declared free variables, local declarations)
      // must NOT be copied — they would shadow the closureParent chain
      // where the outer call's parameter values live.
      //
      // Local variables from Declare statements are safe to drop here
      // because they are re-created at evaluation time when the Declare
      // op is processed by evaluateStatements.
      const innerParamNames = new Set(
        expr.ops
          .slice(1)
          .map((op) => functionLiteralParameterName(op))
          .filter((s) => s)
      );
      const closureBindings: Map<string, BoxedDefinition> = new Map();
      for (const [key, val] of innerBlock.localScope.bindings) {
        if (innerParamNames.has(key)) closureBindings.set(key, val);
      }
      const closureScope: Scope = {
        parent: closureParent,
        bindings: closureBindings,
      };
      const closedBlock = ce._fn('Block', innerBlock.ops, {
        scope: closureScope,
      });
      return ce._fn('Function', [closedBlock, ...expr.ops.slice(1)]);
    }
    return expr;
  }

  // Recurse into compound expressions (List, Tuple, Pair, etc.)
  if (isFunction(expr) && expr.ops.length > 0) {
    let changed = false;
    const newOps = expr.ops.map((op) => {
      const captured = captureClosures(ce, op, closureParent);
      if (captured !== op) changed = true;
      return captured;
    });
    if (changed) return ce._fn(expr.operator!, newOps);
  }

  return expr;
}

/**
 * Capture-avoiding structural substitution.
 *
 * Behaves like `expr.subs(subs)`, except that a nested `Function` literal whose
 * own parameter list binds a substituted name shadows it: the substitution is
 * NOT applied to that name inside the literal, so a returned lambda that
 * re-binds an outer parameter is not corrupted (e.g. `(x ↦ (x ↦ x))(1)` must
 * keep the inner binder intact rather than rewrite it to `x ↦ 1`). Mirrors the
 * `innerParamNames` exclusion used by `captureClosures`.
 */
function captureAvoidingSubs(
  expr: Expression,
  subs: Record<string, Expression>
): Expression {
  const ce = expr.engine;

  // A `Function` literal binds its parameters: drop any shadowed name from the
  // substitution before descending, so an inner binder's occurrences survive.
  let map = subs;
  if (isFunction(expr, 'Function')) {
    const bound = expr.ops
      .slice(1)
      .map((op) => functionLiteralParameterName(op))
      .filter((n): n is string => !!n);
    if (bound.some((n) => n in subs)) {
      map = { ...subs };
      for (const n of bound) delete map[n];
    }
  }
  if (Object.keys(map).length === 0) return expr;

  // Bare symbol: substitute if matched.
  const s = sym(expr);
  if (s !== undefined) return map[s] ?? expr;

  // Leaf (number/string) or tensor: no `Function` literal to capture inside, so
  // the built-in substitution (which also handles rational/tensor structural
  // forms) is safe.
  if (!isFunction(expr) || isTensor(expr)) return expr.subs(map);

  // Recurse into operands, rebuilding as `BoxedFunction.subs` does.
  const ops = expr.ops.map((x) => captureAvoidingSubs(x, map));
  const form = expr.isCanonical || expr.isStructural ? 'canonical' : 'raw';
  if (!ops.every((x) => x.isValid))
    return ce.function(expr.operator, ops, { form: 'raw' });
  return ce.function(expr.operator, ops, { form });
}

/** Operators that hold (do not evaluate) their branch operands, so a branch can
 * survive evaluation still referencing a raw parameter symbol. */
const HELD_CONDITIONAL_OPERATORS: ReadonlySet<string> = new Set([
  'If',
  'Which',
  'When',
  'Match',
]);

/**
 * Does `name` appear inside a HELD conditional (`If`/`Which`/…) within `expr`?
 *
 * Such an occurrence is a raw, unevaluated parameter reference (the branch was
 * never evaluated), NOT the result of resolving the parameter to its value —
 * so it is safe to substitute even when the argument itself references `name`.
 */
function referencesInHeldConditional(expr: Expression, name: string): boolean {
  if (!isFunction(expr)) return false;
  if (HELD_CONDITIONAL_OPERATORS.has(expr.operator) && expr.has(name))
    return true;
  return expr.ops.some((op) => referencesInHeldConditional(op, name));
}

/**
 * If `expr is a function literal (`["Function"]` expression), return a
 * JavaScript function that can be called with arguments.
 */

/** Wrap a lambda so each invocation is counted against `recursionLimit`: a
 * runaway user-function recursion (`f(x) := … f(x-1) …` with no reachable base
 * case) throws a `CancellationError` (`cause: 'recursion-depth-exceeded'`)
 * instead of overflowing the native JS call stack with a `RangeError`. */
function wrapRecursion(
  ce: ComputeEngine,
  fn: (
    params: ReadonlyArray<Expression>,
    options?: Partial<EvaluateOptions>
  ) => Expression | undefined
): (
  params: ReadonlyArray<Expression>,
  options?: Partial<EvaluateOptions>
) => Expression | undefined {
  return (params, options) => {
    ce._enterRecursion();
    try {
      return fn(params, options);
    } finally {
      ce._exitRecursion();
    }
  };
}

function makeLambda(
  expr: Expression
): (
  params: ReadonlyArray<Expression>,
  options?: Partial<EvaluateOptions>
) => Expression | undefined {
  const ce = expr.engine;

  // If the expression is a symbol, interpret it as an operator
  if (isSymbol(expr)) {
    const sym = expr.symbol;
    return (args, options) => ce.function(sym, args).evaluate(options);
  }

  const canonicalExpr = canonicalFunctionLiteral(expr);
  if (!canonicalExpr) throw new Error('Invalid function literal');

  expr = canonicalExpr;

  console.assert(expr.operator === 'Function');
  console.assert(expr.isCanonical);

  // expr is a canonical Function expression — it satisfies FunctionInterface
  const fnExpr = expr as Expression & FunctionInterface;

  //
  // No parameters (nullary function). Extra arguments are ignored (historical
  // contract). Two cases:
  //
  if (fnExpr.ops.length === 1) {
    console.assert(fnExpr.ops[0] !== undefined);
    const onlyBody = fnExpr.ops[0];

    // (a) The body is not a scoped Block: there is no per-call local state to
    //     instantiate, so evaluate it directly (fast path for plain thunks and
    //     bare-expression bodies).
    if (!onlyBody.isScoped || !onlyBody.localScope)
      return wrapRecursion(ce, (_args, options) => onlyBody.evaluate(options));

    // (b) The body IS a scoped Block: it may declare mutable locals (`let`)
    //     captured by an escaping closure — e.g. a counter factory
    //     `() |-> do { let count = 0; () |-> do { count = count + 1; count } }`.
    //     Those locals must live in a fresh per-call scope so separate
    //     invocations don't share state. Evaluate the block's statements in a
    //     fresh scope (parent = the defining scope) and run `captureClosures`,
    //     mirroring the parameterized `invoke` path below — the same machinery
    //     that already makes parameterized factories produce independent
    //     closures. Unlike `invoke`, arguments are ignored rather than
    //     arity-checked, preserving the nullary contract.
    const nullaryBody = onlyBody as Expression & FunctionInterface;
    return wrapRecursion(ce, (_args, options) => {
      const bodyScope = nullaryBody.localScope!;
      const capturedScope = bodyScope.parent ?? ce.context.lexicalScope;
      const freshScope: Scope = { parent: capturedScope, bindings: new Map() };
      const savedParent = bodyScope.parent;
      bodyScope.parent = freshScope;
      ce.pushScope(freshScope);
      let result: Expression;
      try {
        result = unwrapReturn(ce, evaluateStatements(ce, nullaryBody.ops));
        result = resolveEscapingLambda(ce, result);
        result = captureClosures(ce, result, freshScope);
        if (options?.numericApproximation)
          result = result.evaluate({ numericApproximation: true });
      } finally {
        ce.popScope();
        bodyScope.parent = savedParent;
      }
      return result.isValid ? result : undefined;
    });
  }

  const [body, ...params] = fnExpr.ops;

  console.assert(body.isScoped);
  if (!body.localScope)
    throw new Error('Function body must be a scoped Block expression');

  // body is a Block (scoped) — safe to access .ops and .localScope
  const bodyFn = body as Expression & FunctionInterface;

  // Apply-time enforcement (§6.4) is a strict-mode feature gated on the literal
  // carrying at least one annotated parameter — untyped literals skip it
  // entirely (zero overhead). Computed once; `ce.strict` is re-checked at
  // invocation time.
  const hasAnnotatedParam = params.some(
    (p) => functionLiteralParameterType(p) !== undefined
  );

  // The return-type ascription operand (§4.2 marker: the last Block statement
  // wrapped in `["Typed", stmt, type]`), reused verbatim when re-attaching the
  // return type onto a curried literal (§6.5 point 3). `undefined` when the
  // literal has no return ascription.
  const lastStatement = bodyFn.ops[bodyFn.ops.length - 1];
  const returnTypeOp = isFunction(lastStatement, 'Typed')
    ? lastStatement.op2
    : undefined;

  const invoke = (
    args: ReadonlyArray<Expression>,
    options?: Partial<EvaluateOptions>
  ): Expression | undefined => {
    //
    // 1/ If there are more arguments than expected, exit
    //
    if (args.length > params.length) {
      throw new Error(
        `Too many arguments for function "${expr.toString()}": expected ${
          params.length
        }, got ${args.length}`
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
      // Generate unique parameter names for the remaining (unapplied) params
      const unappliedParams = params.slice(args.length);
      const allSymbols = new Set([
        ...body.symbols,
        ...params.map((p) => functionLiteralParameterName(p)),
      ]);
      const extraSymbols = unappliedParams.map((_, i) => {
        let name = `_${i + 1}`;
        let counter = 0;
        while (allSymbols.has(name)) name = `_${i + 1}_${counter++}`;
        allSymbols.add(name);
        return ce.symbol(name, { canonical: false });
      });

      // The curried literal's remaining params keep their annotations (§6.5
      // point 2): an unapplied `["Typed", p, T]` is re-wrapped around the fresh
      // symbol with its original (already-normalized) type operand. The bare
      // fresh symbols are used for body substitution; the wrapped versions
      // become the new Function parameters.
      const extras = unappliedParams.map((param, i) =>
        isFunction(param, 'Typed')
          ? ce._fn('Typed', [extraSymbols[i], param.op2], { canonical: false })
          : extraSymbols[i]
      );

      // Rename remaining params to fresh names in the body
      const substitutions = Object.fromEntries(
        unappliedParams.map((param, i) => [
          functionLiteralParameterName(param),
          extraSymbols[i],
        ])
      );

      // Evaluate body with known args in a fresh scope
      const evaluatedKnownArgs = args.map((a) => a.evaluate());

      // Validate the applied prefix against the declared parameter types
      // (§6.4/§6.5). On mismatch, return the inert application with the
      // error-marked arguments (§13 decision 6).
      if (ce.strict && hasAnnotatedParam && _validateArguments) {
        const fullSig = fnExpr.type.type;
        if (typeof fullSig !== 'string' && fullSig.kind === 'signature') {
          const prefixSig: Type = {
            kind: 'signature',
            args: (fullSig.args ?? []).slice(0, args.length),
            result: fullSig.result,
          };
          const validated = _validateArguments(
            ce,
            evaluatedKnownArgs,
            prefixSig
          );
          if (validated !== null)
            return ce._fn('Apply', [fnExpr, ...validated]);
        }
      }
      const capturedScope =
        bodyFn.localScope!.parent ?? ce.context.lexicalScope;
      const freshScope: Scope = {
        parent: capturedScope,
        bindings: new Map(),
      };
      for (let i = 0; i < args.length; i++) {
        const name = functionLiteralParameterName(params[i]);
        if (name) {
          // See the full-application path: typed binding only in strict mode,
          // where the applied prefix was validated in step 3.
          const pType = typedBinding(ce, params[i], evaluatedKnownArgs[i]);
          if (pType !== undefined)
            ce.declare(
              name,
              { value: evaluatedKnownArgs[i], type: pType, inferred: false },
              freshScope
            );
          else
            ce.declare(
              name,
              { value: evaluatedKnownArgs[i], inferred: true },
              freshScope
            );
        }
      }

      // Re-parent body scope to chain through freshScope, so nested
      // scoped expressions (Sum, Product) can find params by walking up:
      //   bigOpScope → bodyScope → freshScope(params) → capturedScope
      // Also temporarily remove param bindings from bodyScope so they
      // don't shadow the freshScope values during lookup.
      const bodyScope = bodyFn.localScope!;
      const savedParent = bodyScope.parent;
      bodyScope.parent = freshScope;
      const curryParamNames = params
        .slice(0, args.length)
        .map((p) => functionLiteralParameterName(p));
      const hiddenBindings = hideBodyScopeParams(bodyScope, curryParamNames);

      ce.pushScope(freshScope);
      let newBody: Expression;
      try {
        newBody = unwrapReturn(ce, evaluateStatements(ce, bodyFn.ops));
      } finally {
        ce.popScope();
        bodyScope.parent = savedParent;
        restoreBodyScopeParams(bodyScope, hiddenBindings);
      }

      // Re-attach the original return-type ascription onto the curried literal
      // (§6.5 point 3): partial application does not change the result type.
      // `newBody` is the evaluated body (the marker was consumed by
      // evaluation), so wrap it again; canonicalization re-normalizes the
      // ascription inside the Block (Phase 1).
      const curriedBody = newBody.subs(substitutions);
      const finalBody =
        returnTypeOp !== undefined
          ? ce._fn('Typed', [curriedBody, returnTypeOp], { canonical: false })
          : curriedBody;
      return ce.function('Function', [finalBody, ...extras]);
    }

    //
    // 4/ Evaluate arguments in the calling scope before switching context
    //
    const evaluatedArgs = args.map((a) => a.evaluate());

    //
    // 4b/ In strict mode, validate the evaluated arguments against the
    //     literal's declared parameter types (only when the literal carries at
    //     least one annotated parameter — untyped literals skip this entirely,
    //     §6.4). On mismatch, return the inert application carrying the
    //     error-marked arguments (§13 decision 6), matching the named-`Declare`
    //     path so broadcast consumers (`Map`, …) surface the same diagnostic.
    //
    if (ce.strict && hasAnnotatedParam && _validateArguments) {
      const validated = _validateArguments(ce, evaluatedArgs, fnExpr.type.type);
      if (validated !== null) return ce._fn('Apply', [fnExpr, ...validated]);
    }

    //
    // 5/ Create a fresh scope per call with parent = the defining scope.
    //    bodyFn.localScope.parent is the scope where the Function was defined.
    //    This gives true lexical scoping: the fresh scope chain is
    //    [fresh scope (params)] -> [defining scope] -> ...
    //    The calling scope is never in the chain.
    //
    const capturedScope = bodyFn.localScope!.parent ?? ce.context.lexicalScope;
    const freshScope: Scope = {
      parent: capturedScope,
      bindings: new Map(),
    };

    // Declare parameters in the fresh scope. Annotated parameters are declared
    // with their declared type, non-inferred (§6.4); bare parameters stay
    // inferred as before.
    const paramNames = params.map((p) => functionLiteralParameterName(p));
    for (let i = 0; i < params.length; i++) {
      if (paramNames[i]) {
        // Only strict mode declares with the declared type (`inferred: false`),
        // and only there — arguments were validated in step 4b, so the value is
        // compatible. See `typedBinding` for why an `unknown`/`any`/symbolic
        // value (which passed validation as "not provably wrong") still falls
        // back to the historical inferred binding.
        const pType = typedBinding(ce, params[i], evaluatedArgs[i]);
        if (pType !== undefined)
          ce.declare(
            paramNames[i],
            { value: evaluatedArgs[i], type: pType, inferred: false },
            freshScope
          );
        else
          ce.declare(
            paramNames[i],
            { value: evaluatedArgs[i], inferred: true },
            freshScope
          );
      }
    }

    // Re-parent body scope to chain through freshScope, so nested
    // scoped expressions (Sum, Product) can find params by walking up:
    //   bigOpScope → bodyScope → freshScope(params) → capturedScope
    // Also temporarily remove param bindings from bodyScope so they
    // don't shadow the freshScope values during lookup.
    const bodyScope = bodyFn.localScope!;
    const savedParent = bodyScope.parent;
    bodyScope.parent = freshScope;
    const hiddenBindings = hideBodyScopeParams(bodyScope, paramNames);

    // Push fresh scope and evaluate block contents directly.
    // We evaluate bodyFn.ops (the Block's children) rather than calling
    // body.evaluate() — see evaluateStatements JSDoc for why.
    ce.pushScope(freshScope);
    let result: Expression;
    try {
      result = unwrapReturn(ce, evaluateStatements(ce, bodyFn.ops));

      // A function body whose final value is a *bare symbol* bound to a
      // user-defined function literal (`helper(x) = …`, which creates an
      // operator definition local to this call frame) must return that
      // function as a first-class value so it can escape the frame. The
      // operator definition is unreachable once the frame is popped, but its
      // stored literal (`_lambdaLiteral`) is a plain value. Resolve it here,
      // while the frame is still pushed and the definition is reachable;
      // `captureClosures` (next) then rebinds the literal's free variables to
      // this frame. (Built-in operators are not lambdas and are unaffected.)
      result = resolveEscapingLambda(ce, result);

      // Closure capture: walk the result tree and rebind any Function literals
      // so their body scopes close over the current freshScope.
      //
      // Without this, inner functions' Block._localScope.parent points to
      // the static defining scope, so outer-call parameters are lost once
      // freshScope is popped.
      result = captureClosures(ce, result, freshScope);

      // Substitute each parameter's VALUE into a partially-symbolic result that
      // still references the parameter symbol. A body that cannot fully evaluate
      // (e.g. `Which`/`If` with an undetermined condition) returns itself inert,
      // referencing the raw parameter symbol rather than the bound value; once
      // `freshScope` is popped that symbol is unbound, so every element of a
      // lazy `Map`/`Filter`/`Tabulate` stream would otherwise lose its argument
      // (Tycho item 26). This mirrors the comprehension stream's
      // `comprehensionIndexSubs` fix. It is a no-op for a body that already
      // resolved its parameters.
      //
      // The substitution is capture-avoiding (`captureAvoidingSubs`): a returned
      // lambda that re-binds the parameter (e.g. `(x ↦ (x ↦ x))(1)`) keeps its
      // inner binder rather than having it rewritten.
      //
      // When the ARGUMENT itself references `name`, a naive substitution can
      // double-apply a `name` that the body already resolved to its value — the
      // `x` then present in the result came from the value, not from an
      // unevaluated parameter reference. Examples that must be left alone:
      // `Apply(x ↦ x, Hold(x))` (result `Hold(x)`, else `Hold(Hold(x))`),
      // `Apply(x ↦ x + 1, x + 1)` (result `x + 2`, else `x + 3`). We still
      // substitute in that ambiguous case when `name` survives inside a HELD
      // conditional (`If`/`Which`/…) — an unevaluated branch that genuinely
      // holds the raw parameter (Tycho item 26) — and the result is not simply
      // the argument echoed back.
      if (result.has(paramNames as string[])) {
        let subs: Record<string, Expression> | undefined;
        for (let i = 0; i < params.length; i++) {
          const name = paramNames[i];
          if (!name || !result.has(name)) continue;
          const value = evaluatedArgs[i];
          if (
            value.has(name) &&
            (result.isSame(value) || !referencesInHeldConditional(result, name))
          )
            continue;
          (subs ??= {})[name] = value;
        }
        if (subs !== undefined) result = captureAvoidingSubs(result, subs);
      }

      // Honor a numeric-approximation request (`N(f(2))`) by approximating
      // the (exactly-evaluated) result HERE, while the function's scope
      // frame is still pushed. Approximating after the frame is popped
      // would re-resolve free symbols in the *caller's* dynamic context,
      // breaking lexical scoping (see scope.test.ts "Dynamic scoping").
      if (options?.numericApproximation)
        result = result.evaluate({ numericApproximation: true });
    } finally {
      ce.popScope();
      bodyScope.parent = savedParent;
      restoreBodyScopeParams(bodyScope, hiddenBindings);
    }

    return result.isValid ? result : undefined;
  };

  return wrapRecursion(ce, invoke);
}

/**
 * Return a lambda function, assuming a scoped environment has been
 * created and there is a single numeric argument
 */
export function makeLambdaN1(
  expr: Expression
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
  fn: Expression
): (
  xs: ReadonlyArray<Expression>,
  options?: Partial<EvaluateOptions>
) => Expression | undefined {
  return (
    makeLambda(fn) ??
    ((xs, options) =>
      fn.engine.function('Apply', [fn, ...xs]).evaluate(options))
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
export function applicableN1(fn: Expression): (x: number) => number {
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
