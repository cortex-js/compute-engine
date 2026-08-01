import { MathJsonSymbol } from '../math-json.js';
import { cmp } from './boxed-expression/compare.js';
import {
  evaluateInOwnBindings,
  markActivation,
  rebindToBindings,
  rewriteWithBinders,
  sameBindingDef,
} from './boxed-expression/binders.js';
import type {
  BoxedDefinition,
  BoxedValueDefinition,
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
  sym,
} from './boxed-expression/type-guards.js';
import {
  functionLiteralParameterName,
  functionLiteralParameterType,
} from './boxed-expression/function-literal.js';
import { errorValue } from './boxed-expression/error-value.js';
import { effectsOf } from './boxed-expression/effects-of.js';
import { isPureComputedEffects } from '../common/type/effects.js';
import type { Type } from '../common/type/types.js';
import { parseType } from '../common/type/parse.js';
import { typeToString } from '../common/type/serialize.js';
import { signatureEffects } from '../common/type/utils.js';

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
  freshlyInferred?: ReadonlySet<BoxedValueDefinition>
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
  //    Exception: the BARE wildcard `_` is the identity-function shorthand
  //    (`Map(xs, _)` ≡ `Map(xs, x ↦ x)`). It falls through to the shorthand
  //    path below, which turns it into `(_1) ↦ _1`. Only the bare `_`
  //    qualifies: `_1`/`_2`/… are positional parameters of an ENCLOSING
  //    shorthand, and a named wildcard is a pattern variable — neither is an
  //    identity function.
  //
  if (isSymbol(expr) && !isSymbol(expr, '_')) return expr;

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
    return canonicalFunctionLiteralOperands(expr.engine, expr.ops);

  //
  // 6/ Shorthand function literal,
  // e.g. `["Add", "_", 1]` or `["Add", "x", 1]`
  //
  console.assert(expr.operator !== 'Function');

  const ce = expr.engine;
  let [body, params] = anonymousParameters(expr);

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

/**
 * Canonicalize the operands of a `["Function", …]` literal — the body followed
 * by its parameter list.
 *
 * This is `canonicalFunctionLiteralArguments` plus the anonymous-parameter
 * rule, and it is what every route that canonicalizes a *user-written*
 * `Function` literal must use (the `Function` operator's own `canonical`
 * handler, and `canonicalFunctionLiteral` for a function-slot operand).
 * Callers that synthesize a closure from a body and a known binder list (a
 * `Match` arm, `D`) deliberately use `canonicalFunctionLiteralArguments`
 * directly: their body's `_` is not a parameter.
 *
 * The rule: in `["Function", body]` — no explicit parameter list — anonymous
 * parameters used by the body (`_`, `_1`, …) ARE the parameter list, exactly
 * as in the shorthand spelling, so `["Function", ["Add", "_", 1]]` and
 * `["Add", "_", 1]` denote the same lambda. Without it the literal becomes a
 * NULLARY function that never binds its argument (`() ↦ _ + 1`), and
 * `Filter(xs, ["Function", ["Less", "_", 10]])` throws instead of filtering.
 *
 * This form is also the engine's OWN serialization: `toMathJson()` emits a
 * wildcard-parameter lambda by DROPPING the parameter list (see the `Function`
 * case of `serializePrettyJsonFunction`), so `["Function", ["Greater", "_1", 5]]`
 * has to round-trip back to the unary lambda it came from.
 *
 * A body with no wildcard keeps the literal nullary — `["Function", 42]` and
 * `["Function", ["Add", "x", 1]]` are thunks, not unary functions.
 *
 * Regressed in 0e8c11b9, which replaced `canonicalFunctionExpression` (it
 * derived the wildcard parameters from the body) with
 * `canonicalFunctionLiteral`, whose `Function` branch forwarded the operands
 * unchanged.
 */
export function canonicalFunctionLiteralOperands(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  if (ops.length === 1) {
    const [body, params] = anonymousParameters(ops[0]);
    if (params.length > 0)
      return canonicalFunctionLiteralArguments(ce, [body, ...params]);
  }
  return canonicalFunctionLiteralArguments(ce, ops);
}

/**
 * The anonymous ("wildcard") parameters `_`, `_1`, … `_9` that `expr` uses, in
 * index order, together with the body in which the bare `_` has been
 * normalized to `_1`. The parameter list is empty when the expression uses no
 * wildcard — the caller then decides what the parameters are (the shorthand
 * path falls back to the body's unknowns; the `["Function", body]` path keeps
 * the literal nullary).
 */
function anonymousParameters(
  expr: Expression
): [body: Expression, params: Expression[]] {
  // Replace '_' with '_1'
  const body = expr.subs({ _: '_1' });

  const params: Expression[] = [];
  for (let i = 1; i < 10; i++)
    if (body.has(`_${i}`))
      params.push(body.engine.symbol(`_${i}`, { canonical: false }));

  return [body, params];
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

  // Signature-string sugar (typed-literals design §3.2/§10):
  // `["Function", body, "'(n: integer) -> complex'"]` desugars into the
  // structural form — each named argument becomes a `["Typed", name, type]`
  // parameter and a non-`unknown` result becomes the body's return-type
  // ascription. Applied only when the single parameter operand is a string
  // parsing to a signature type with every argument named and no
  // optional/variadic markers (those need `makeLambda` arity support);
  // anything else falls through to the standard expected-a-symbol error.
  if (ops.length === 2 && isString(ops[1])) {
    const desugared = desugarSignatureString(ce, ops[0], ops[1].string);
    if (desugared !== undefined)
      return canonicalFunctionLiteralArguments(ce, desugared);
  }

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

  // Re-bind parameter occurrences that were canonicalized OUTSIDE this Block.
  //
  // Canonicalizing an already-canonical body is a no-op, so a body that was
  // bound before the literal was built keeps those bindings — and its
  // parameter occurrences then denote whatever the enclosing scope had, not
  // this literal's parameters. The shorthand route does exactly that: `Pipe`
  // is lazy and takes `.canonical` of its right operand, so `x |> Map(_, f)`
  // binds `_1` in the CALLER's scope before `Map(_1, f)` is wrapped into
  // `(_1) ↦ Map(_1, f)`. The parameter then looks like a free variable, and
  // anything keyed on binding — the post-evaluation substitution in
  // `makeLambda`, symbol equality — cannot see it is the parameter.
  //
  // Rebinding is scoped to the names this literal binds, so nothing else in
  // the body moves.
  block = rebindParameters(block, params);

  return ce._fn('Function', [
    block,
    ...bindParameterOperands(ce, block, params),
  ]);
}

/**
 * Make each PARAMETER OPERAND denote the binding the body `Block` declares for
 * it — step 5 of the binder discipline
 * (`docs/plans/2026-07-26-binder-mechanism-design.md` §1.3), for the one binder
 * that is not definition-driven.
 *
 * What arrived there differed by route, exactly as it did for `Series` and
 * `Integrate` before their migration: the parse and `ce.box` routes leave the
 * parameter RAW (a symbol with no definition), while
 * `ce.function('Function', [body, ce.symbol('x')])` hands over a symbol
 * carrying the CALLER's binding — a binding that has nothing to do with this
 * literal and, for a caller-assigned `x`, holds a value.
 *
 * Afterwards the literal has exactly ONE binding for the parameter, referenced
 * from both the parameter operand and the body's occurrences. That is what
 * makes the "two live bindings at once" state (`Limit`'s migration attempt,
 * §Stages 5–8 round) detectable rather than silent: a second binder declaring
 * the parameter in ITS scope would show up here as a parameter operand that no
 * longer matches the body.
 */
function bindParameterOperands(
  ce: ComputeEngine,
  block: Expression,
  params: ReadonlyArray<Expression>
): ReadonlyArray<Expression> {
  const scope = block.localScope;
  if (!scope) return params;
  return params.map((param) => {
    const name = functionLiteralParameterName(param);
    if (!name) return param;
    // Inline value-def check (`isValueDef` lives in `utils.ts`, which this
    // module cannot import).
    const binding = scope.bindings.get(name);
    if (binding === undefined || !('value' in binding)) return param;
    const def = (binding as { value: BoxedValueDefinition }).value;
    const site = isFunction(param, 'Typed') ? param.op1 : param;
    if (
      (site as { valueDefinition?: BoxedValueDefinition }).valueDefinition ===
      def
    )
      return param;
    // Built on the Block's OWN binding rather than by name: `ce.symbol()` would
    // short-circuit to the interned constant for a parameter named after one
    // (`Pi`, `e`, `i`, ...) and hand back something that is not this
    // parameter at all.
    const bound = ce._bindingSymbol(name, scope);
    if (bound === undefined) return param;
    if (!isFunction(param, 'Typed')) return bound;
    return ce._fn('Typed', [bound, param.op2], { canonical: false });
  });
}

/** Point every occurrence of this literal's parameter names at the binding the
 * body Block declares for them. See the call site for why an already-canonical
 * body can arrive bound elsewhere.
 *
 * EVERY parameter, named as well as anonymous. The invariant is that a
 * parameter occurrence in the body denotes THIS literal's parameter — and
 * nothing else about the body moves, because only the names this literal binds
 * are targets and only occurrences that resolve elsewhere are touched.
 *
 * This used to be restricted to the anonymous placeholders (`_`, `_1`, …)
 * produced by the shorthand/pipe desugaring, because widening it broke three
 * things. All three were the same latent defect rather than a reason to keep
 * the restriction, and are fixed: `Integrate` handed the antiderivative
 * machinery a body still bound to the literal's Block while that machinery
 * minted the integration variable in the caller's scope (`liftIntegrand`,
 * `library/calculus.ts`), and a BINDING SITE held raw by a lazy operator must
 * not be canonicalized (the raw-occurrence rule of `rebindToBindings`).
 *
 * The walk itself is `rebindToBindings` (`binders.ts`), shared with the binder
 * mechanism's post-phase: this is the same repair, for the one binder that is
 * not definition-driven. */
function rebindParameters(
  block: Expression,
  params: ReadonlyArray<Expression>
): Expression {
  const scope = block.localScope;
  if (!scope) return block;

  const names: string[] = [];
  for (const param of params) {
    const name = functionLiteralParameterName(param);
    if (!name || names.includes(name)) continue;
    // Inline value-def check (`isValueDef` lives in `utils.ts`, which this
    // module cannot import).
    const binding = scope.bindings.get(name);
    if (binding !== undefined && 'value' in binding) names.push(name);
  }
  if (names.length === 0) return block;

  // The replacement symbols are built on the Block's OWN bindings
  // (`_bindingSymbol`), not resolved by name: `ce.symbol()` binds against the
  // current lexical scope — the enclosing one — and, for a parameter named
  // after a library constant, short-circuits to the constant even inside the
  // Block's scope. The rewrite itself still runs in that scope, so a node it
  // rebuilds canonicalizes where its operands are bound. `skipRootBinds`: the
  // Block's own bindings ARE the rebind targets, so the root must not shadow
  // them; a nested binder that re-binds one of these names owns its
  // occurrences (`shadowed`).
  const ce = block.engine;
  const targets = new Map<string, Expression>();
  for (const name of names) {
    const bound = ce._bindingSymbol(name, scope);
    if (bound !== undefined) targets.set(name, bound);
  }
  return ce._inScope(scope, () =>
    rebindToBindings(block, scope, targets, { skipRootBinds: true })
  );
}

/** Desugar a signature-string `Function` parameter (typed-literals design
 * §3.2 sugar) into structural operands `[body, ...params]`, or `undefined`
 * when the string is not a fully-named, non-variadic signature type. An
 * `unknown`/`any` argument or result type stays unannotated; an explicit
 * `Typed` body ascription is kept over the signature's result type. */
function desugarSignatureString(
  ce: ComputeEngine,
  body: Expression,
  signature: string
): Expression[] | undefined {
  let type: Type;
  try {
    type = parseType(signature);
  } catch {
    return undefined;
  }
  if (typeof type === 'string' || type.kind !== 'signature') return undefined;
  if (type.optArgs || type.variadicArg) return undefined;
  const args = type.args ?? [];
  if (args.some((a) => !a.name)) return undefined;

  const isWide = (t: Type): boolean => t === 'unknown' || t === 'any';
  const params = args.map((a) =>
    isWide(a.type)
      ? ce.symbol(a.name!)
      : ce._fn('Typed', [ce.symbol(a.name!), ce.string(typeToString(a.type))], {
          canonical: false,
        })
  );
  let newBody = body;
  if (isFunction(body, 'Typed')) {
    // The body's own ascription wins over the signature string's result.
  } else if (signatureEffects(type) !== undefined) {
    // Arrow-level effects are PRESERVED onto the constructed signature
    // (`docs/EFFECTS-MODEL.md`, "Cortex surface"), so the FULL signature is
    // ascribed — regardless of `isWide(type.result)`, since the wide-result
    // convention keeps the return inferred downstream.
    newBody = ce._fn('Typed', [body, ce.string(typeToString(type))], {
      canonical: false,
    });
  } else if (!isWide(type.result))
    newBody = ce._fn('Typed', [body, ce.string(typeToString(type.result))], {
      canonical: false,
    });
  return [newBody, ...params];
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

/** The shorthand-lambda placeholder symbols: `_` and `_1`…`_9`. An expression
 * containing any of these is a shorthand function body (case 6 of
 * `canonicalFunctionLiteral`). */
const WILDCARD_SYMBOLS = [
  '_',
  '_1',
  '_2',
  '_3',
  '_4',
  '_5',
  '_6',
  '_7',
  '_8',
  '_9',
];

/**
 * Canonicalize `expr` with the shorthand-lambda placeholders it mentions
 * (`_`, `_1`…`_9`) bound to FRESH, valueless locals.
 *
 * `Pipe` is lazy, so it canonicalizes its held right operand in the CALLER's
 * scope — before `canonicalFunctionLiteral` wraps `Map(_1, f)` into
 * `(_1) ↦ Map(_1, f)`. A placeholder is a parameter of that literal and must
 * shadow a same-named global, in particular its VALUE: with a global
 * `_1 := 7`, `Map`'s canonical handler saw a non-collection source operand,
 * declined (`checkCollectionOperand`), and `[1,2,3] |> Map(_1, k ↦ k²)`
 * returned an unevaluated `Map`.
 *
 * The placeholders are PRE-DECLARED in a throwaway scope rather than left to
 * auto-declaration. `_pushShadowedParameters` alone does not shadow here:
 * its untyped branch deliberately reuses an existing non-constant binding
 * (that IS the valued global), and its typed branch auto-declares into the
 * current lexical scope — the very scope the global lives in. The throwaway
 * scope is `noAutoDeclare`, so a genuine free variable in the operand still
 * auto-declares in the caller's scope exactly as before; only the
 * placeholders are intercepted.
 */
export function canonicalWithFreshPlaceholders(expr: Expression): Expression {
  const names = WILDCARD_SYMBOLS.filter((name) => expr.has(name));
  if (names.length === 0) return expr.canonical;
  const ce = expr.engine;
  const scope: Scope = {
    parent: ce.context.lexicalScope,
    bindings: new Map(),
    noAutoDeclare: true,
  };
  for (const name of names)
    ce._declareSymbolValue(name, { type: 'unknown', inferred: true }, scope);
  return ce._inScope(scope, () => expr.canonical);
}

/**
 * How an application treats an argument whose value is — or embeds — an
 * `Error`. See `docs/plans/2026-07-31-error-propagation-design.md` §2.
 *
 * - `'bubble'` (the default): error is the absorbing element of strict
 *   evaluation, so the application evaluates to that error value and the body
 *   never runs.
 * - `'bind'`: the error is an ordinary value, bound to the parameter. Reserved
 *   for the non-strict OBSERVERS — the `Match` case guards and bodies, which
 *   have already decided on the error subject and are the rescue construct.
 */
export type ErrorArgPolicy = 'bubble' | 'bind';

/** The first argument that is — or embeds — an `Error`, as its error value.
 * A plain loop: this runs on every application. */
function firstErrorArg(
  args: ReadonlyArray<Expression>
): Expression | undefined {
  for (const a of args) {
    const err = errorValue(a);
    if (err !== undefined) return err;
  }
  return undefined;
}

/**
 * Apply arguments to an expression which is either:
 * - a `["Function"]` expression
 * - the symbol for a function, e.g. `Sin`.
 */
export function apply(
  fn: Expression,
  args: ReadonlyArray<Expression>,
  options?: Partial<EvaluateOptions>,
  errorPolicy: ErrorArgPolicy = 'bubble'
): Expression {
  // Rung 2: applying something that IS an error bubbles it (`err(x)`), as does
  // applying a function literal to an error argument.
  //
  // A bare SYMBOL callee is deliberately excluded here: it is dispatched below
  // through `ce.function(sym, args).evaluate()`, where the direct-call route
  // decides — bubbling for a user function, freezing for a built-in operator
  // (`err |> Sin` must stay `Sin(err)`, exactly like `Sin(err)`; operators are
  // rung 3). That is what keeps `x |> f` ≡ `f(x)` for every callee.
  if (errorPolicy === 'bubble' && !isSymbol(fn)) {
    const err = errorValue(fn) ?? firstErrorArg(args);
    if (err !== undefined) return err;
  }

  // A function-valued expression that is not itself a `Function` literal
  // DENOTES a function (e.g. `Derivative(f, n)`, `InverseFunction(f)`); it
  // cannot be beta-reduced and must stay symbolic when applied. Letting
  // `makeLambda` treat such an expression as a shorthand lambda body would
  // substitute the argument for its free symbol (`Apply(InverseFunction(f), 2)`
  // → `InverseFunction(2)`), or, for `Derivative(f, n)` whose `derivative()`
  // representation is the self-applied lambda `Apply(Derivative(f, n), _)`,
  // re-evaluate the inner `Derivative`, regenerating the same lambda and
  // recursing forever (stack overflow). Wildcards (`_`, `_1`…`_9`) mark a
  // genuine shorthand body, so an expression containing one is NOT gated here
  // and still beta-reduces. (The `lazy` attribute was considered as the gate
  // and rejected: laziness governs whether operands are evaluated, not whether
  // the expression is function-valued.)
  const denotesFunction = (e: Expression | undefined | null): boolean =>
    isFunction(e) &&
    e.operator !== 'Function' &&
    e.type.matches('function') &&
    !e.has(WILDCARD_SYMBOLS);

  if (denotesFunction(fn)) return fn.engine._fn('Apply', [fn, ...args]);

  if (isFunction(fn, 'Apply') && denotesFunction(fn.op1))
    return fn.engine._fn('Apply', [fn.op1, ...args]);

  const result = makeLambda(fn, errorPolicy)?.(args, options);
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
 *
 * The first reason is NOT the one activation records retire. §2.1 of the
 * binder-mechanism design expected it to narrow to the second, on the grounds
 * that a frame's definition and the body's now resolve to the same binding —
 * which is true, and irrelevant here: this list is consumed by NAME LOOKUP,
 * not by binding comparison. Dropping the parameter clause leaves an
 * ANNOTATED parameter (declared `inferred: false`, so not covered by the
 * second clause) valueless-but-visible in bodyScope, where a nested `Block`
 * or `Sum` resolving up the chain finds it before `freshScope`'s value.
 * Measured: `f(n: integer) = if n <= 1 { 1 } else { n * f(n-1) }` returns
 * `NaN` (`test/cortex/execute.test.ts` › 'recursion with a typed param still
 * works'). What activation records DID retire is the three-candidate binding
 * search in `bindingKeyedSubs`, which is where the "two live bindings at once"
 * state was actually observable.
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

/**
 * Declare a parameter in a call frame's `freshScope`, and record that the
 * binding it creates is an ACTIVATION of the one the literal's body `Block`
 * declares for the same parameter
 * (`docs/plans/2026-07-26-binder-mechanism-design.md` §2.1).
 *
 * The "two live bindings at once" state this repairs is not removable: the
 * call's value has to live somewhere other than the literal, or two
 * simultaneous calls would overwrite each other. What the activation link adds
 * is that the two are no longer *unrelated* — `sameBindingDef` resolves both
 * to the static binding, so every consumer that asks "does this occurrence
 * denote the parameter?" gets one answer instead of having to enumerate the
 * places a parameter binding can live.
 *
 * The static binding is read from the PARAMETER OPERAND, not from
 * `bodyScope.bindings`: an enclosing activation of the same literal
 * (recursion) has already hidden the body's binding for the duration of ITS
 * call (`hideBodyScopeParams`), so by the second frame the scope no longer
 * answers. The binding OBJECT survives the hiding, and since stage 10 the
 * parameter operand is a live reference to exactly it — which is what makes
 * recursion work here at all. (Measured: keying on `bodyScope` left every
 * frame of a recursive call unlinked.)
 *
 * Only strict mode declares with the declared type (`inferred: false`); see
 * `typedBinding` for why an `unknown`/`any`/symbolic value still falls back to
 * the historical inferred binding.
 */
function declareParameterActivation(
  ce: ComputeEngine,
  name: string,
  param: Expression,
  value: Expression,
  freshScope: Scope,
  bodyScope: Scope | undefined
): void {
  const pType = typedBinding(ce, param, value);
  if (pType !== undefined)
    ce.declare(name, { value, type: pType, inferred: false }, freshScope);
  else ce.declare(name, { value, inferred: true }, freshScope);

  const staticBinding = staticParameterBinding(param, name, bodyScope);
  if (staticBinding === undefined) return;
  // Inline value-def check (`isValueDef` lives in `utils.ts`, which this
  // module cannot import).
  const activation = freshScope.bindings.get(name);
  if (activation !== undefined && 'value' in activation)
    markActivation(activation.value, staticBinding);
}

/** The literal's OWN binding for a parameter: the operand's, falling back to
 * the body scope's for a literal whose operand was never bound to it (a
 * hand-built `Function` node that skipped `bindParameterOperands`). */
function staticParameterBinding(
  param: Expression,
  name: string,
  bodyScope: Scope | undefined
): BoxedValueDefinition | undefined {
  const site = isFunction(param, 'Typed') ? param.op1 : param;
  const def = (site as { valueDefinition?: BoxedValueDefinition })
    .valueDefinition;
  if (def !== undefined) return def;
  const binding = bodyScope?.bindings.get(name);
  return binding !== undefined && 'value' in binding
    ? binding.value
    : undefined;
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

/** One parameter's post-evaluation substitution: the literal's OWN binding for
 * it, its name, the value to substitute, and whether the ARGUMENT mentions the
 * name (see `bindingKeyedSubs`). */
type ParameterSub = readonly [
  binding: BoxedValueDefinition | undefined,
  name: string,
  value: Expression,
  ambiguous: boolean,
];

/**
 * Substitute by BINDING identity: rewrite an occurrence only when it resolves
 * to the given binding, whatever it is spelled.
 *
 * "Resolves to" is `sameBindingDef`, so a call frame's ACTIVATION of the
 * parameter counts as the parameter — which is what lets this ask ONE question
 * where it used to enumerate the three places a parameter's binding can live
 * (the body binding hidden by `hideBodyScopeParams`, the live body binding,
 * and `freshScope`'s).
 *
 * `ambiguous` is the item-26 guard, and it is the one thing the two sides of an
 * activation are still distinguished for. When the argument itself mentions the
 * parameter's name, an occurrence bound on the ACTIVATION side may have been
 * bound by canonicalizing the ARGUMENT in-frame rather than by the body —
 * substituting it double-applies (`Apply(x ↦ x, Hold(raw x))` must stay
 * `Hold(x)`). An occurrence carrying the literal's own binding cannot have come
 * from the argument, so it stays substitutable even when ambiguous
 * (`Apply(w ↦ If(c, w, 0), w + 1)` = `If(c, w + 1, 0)`).
 *
 * The binding-keyed half needs no shadowing exclusion — a nested `Function`
 * literal that re-binds the name declares a DIFFERENT binding (not an
 * activation of this one), so its occurrences simply do not match, and
 * `(x ↦ (x ↦ x))(1)` keeps its inner binder for free. The RAW-name fallback
 * half is name-based, so it does need one: any binder between the root and the
 * occurrence that binds the name — a nested literal's parameter list, but also
 * a scoped operator's `localScope` (the parser leaves a `Sum`'s binding-site
 * symbol raw) — owns its occurrences, and the walker's `shadowed` set carries
 * exactly that.
 */
function bindingKeyedSubs(
  expr: Expression,
  subs: ReadonlyArray<ParameterSub>
): Expression {
  return rewriteWithBinders(expr, (sym, shadowed) => {
    const def = (sym as { valueDefinition?: BoxedValueDefinition })
      .valueDefinition;
    for (const [binding, name, value, ambiguous] of subs) {
      // Bound: it denotes this parameter — either the literal's own binding or
      // this frame's activation of it.
      if (
        def !== undefined &&
        binding !== undefined &&
        sameBindingDef(def, binding) &&
        (!ambiguous || def === binding)
      )
        return value;
      // Raw: a lazy operator holds its operands unevaluated, so the body
      // source reaches here un-canonicalized and its parameter references
      // carry no binding at all (`Map`'s held body, a pipe's `_1` topic). An
      // unbound occurrence has nothing else it could denote inside this
      // frame, so the name is the whole answer — the same rule the equality
      // contract uses for a raw operand.
      if (
        def === undefined &&
        sym.symbol === name &&
        shadowed?.has(name) !== true
      )
        return value;
    }
    return sym;
  });
}

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
  expr: Expression,
  errorPolicy: ErrorArgPolicy = 'bubble'
):
  | ((
      params: ReadonlyArray<Expression>,
      options?: Partial<EvaluateOptions>
    ) => Expression | undefined)
  | undefined {
  const ce = expr.engine;

  // If the expression is a symbol, interpret it as an operator
  if (isSymbol(expr)) {
    const sym = expr.symbol;
    return (args, options) => ce.function(sym, args).evaluate(options);
  }

  const canonicalExpr = canonicalFunctionLiteral(expr);
  // Not a function literal (e.g. a bare string or number): decline so callers
  // fall through to their symbolic `Apply(fn, args)` fallback instead of
  // throwing (`apply()` uses `makeLambda(fn)?.(...)`).
  if (!canonicalExpr) return undefined;

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
    // 2/ An argument that is — or embeds — an `Error` (rung 2 of the
    //    error-propagation design): the application evaluates to that error
    //    value, and the body never runs. Under the `'bind'` policy the caller
    //    is an observer that has already decided on the error (a `Match` case),
    //    so it is bound like any other value.
    //
    if (errorPolicy === 'bubble') {
      const err = firstErrorArg(args);
      if (err !== undefined) return err;
      // Not dead: `errorValue` does NOT descend into collection values, so an
      // argument like `[1, "a" + 1]` is invalid without yielding an error to
      // bubble. This keeps the body from running for it (the result would be
      // discarded by the `result.isValid` gate at the end of `invoke` anyway).
      if (ce.strict && !args.every((x) => x.isValid)) return undefined;
    }

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
      let evaluatedKnownArgs = args.map((a) => a.evaluate());

      // An argument that only became an error when EVALUATED (`f(g(1))` with
      // `g(1)` failing) bubbles like a literal one — see step 2.
      if (errorPolicy === 'bubble') {
        const err = firstErrorArg(evaluatedKnownArgs);
        if (err !== undefined) return err;
      }

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
          if (validated !== null) {
            // Any invalid operand: mismatch — return the inert application.
            if (validated.some((x) => !x.isValid))
              return ce._fn('Apply', [fnExpr, ...validated]);
            // All valid: an operand was substituted (e.g. devolved); proceed
            // with the substituted arguments.
            evaluatedKnownArgs = [...validated];
          }
        }
      }
      // Purity-gated pre-evaluation (`docs/EFFECTS-MODEL.md`, "Currying /
      // partial application"). Evaluating the body with the applied prefix is
      // an optimization: the residual literal carries an already-reduced body.
      // It is only sound for a PURE body — an effectful one would fire its
      // effects at partial application, and again at saturation. So an
      // effectful body is CAPTURED WITHOUT EVALUATION, as a residual that
      // re-applies the ORIGINAL literal to the prefix once the last argument
      // arrives: `(a, b) ↦ body` applied to `1` becomes
      // `(_1) ↦ Apply((a, b) ↦ body, 1, _1)`.
      //
      // Substituting the prefix VALUES into the body instead would be the
      // obvious encoding and is wrong: `subs()` is not capture-avoiding, so a
      // nested literal that rebinds a parameter name has its own parameter
      // symbol overwritten (`(a) ↦ a * 2` becomes `(1) ↦ 2`). Re-application
      // keeps the body untouched, and binding goes through the same scope
      // machinery as a saturated call.
      //
      // The prefix ARGUMENTS are evaluated either way (above): producing an
      // operand is not the body's effect, and eager operands are evaluated at
      // the call that supplies them.
      if (!isPureComputedEffects(effectsOf(body))) {
        const deferred = ce._fn(
          'Apply',
          [fnExpr, ...evaluatedKnownArgs, ...extraSymbols],
          { canonical: false }
        );
        return ce.function('Function', [
          returnTypeOp !== undefined
            ? ce._fn('Typed', [deferred, returnTypeOp], { canonical: false })
            : deferred,
          ...extras,
        ]);
      }

      const capturedScope =
        bodyFn.localScope!.parent ?? ce.context.lexicalScope;
      const freshScope: Scope = {
        parent: capturedScope,
        bindings: new Map(),
      };
      for (let i = 0; i < args.length; i++) {
        const name = functionLiteralParameterName(params[i]);
        if (name)
          // Typed binding only in strict mode, where the applied prefix was
          // validated in step 3.
          declareParameterActivation(
            ce,
            name,
            params[i],
            evaluatedKnownArgs[i],
            freshScope,
            bodyFn.localScope
          );
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
    let evaluatedArgs = args.map((a) => a.evaluate());

    // An argument that only became an error when EVALUATED (`f(g(1))` with
    // `g(1)` failing) bubbles like a literal one — see step 2.
    if (errorPolicy === 'bubble') {
      const err = firstErrorArg(evaluatedArgs);
      if (err !== undefined) return err;
    }

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
      if (validated !== null) {
        // Any invalid operand: mismatch — return the inert application.
        if (validated.some((x) => !x.isValid))
          return ce._fn('Apply', [fnExpr, ...validated]);
        // All valid: an operand was substituted (e.g. devolved); proceed with
        // the substituted arguments.
        evaluatedArgs = [...validated];
      }
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
      if (paramNames[i])
        // Arguments were validated in step 4b, so a strict-mode typed binding
        // is known compatible.
        declareParameterActivation(
          ce,
          paramNames[i]!,
          params[i],
          evaluatedArgs[i],
          freshScope,
          bodyFn.localScope
        );
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
      // Keyed on the parameter's BINDING, not its name. The question is "did
      // this occurrence come from an unevaluated reference to the parameter?",
      // and the binding answers it exactly: an occurrence resolving to the
      // body's parameter binding did, and one that merely shares the spelling
      // — a free symbol that arrived inside a dereferenced stored value, or an
      // inner lambda's own re-binding of the name — did not.
      //
      // This replaces a name-keyed substitution that could not tell those
      // apart and needed three heuristics to approximate the difference: a
      // capture-avoiding walk to protect a returned lambda that re-binds the
      // parameter, a held-conditional test, and an argument-ambiguity test for
      // `Apply(x ↦ x + 1, x + 1)` (which must be `x + 2`, not `x + 3`). All
      // three fall out of asking the right question: a re-binding lambda
      // declares a DIFFERENT binding, and an `x` that came from the argument's
      // value carries the caller's binding, so neither matches.
      if (result.has(paramNames as string[])) {
        // ONE binding per parameter — the literal's own. `hideBodyScopeParams`
        // has removed it from `bodyScope` for the duration of the call, and
        // the call's value lives in a SEPARATE definition in `freshScope`; the
        // activation link (`declareParameterActivation`) is what makes both
        // resolve to it, so this no longer has to enumerate the places a
        // parameter's binding can be found. The raw-occurrence case is still
        // name-keyed — a raw symbol carries no binding at all.
        const subs: ParameterSub[] = [];
        for (let i = 0; i < params.length; i++) {
          const name = paramNames[i];
          if (!name || !result.has(name)) continue;
          subs.push([
            staticParameterBinding(params[i], name, bodyScope),
            name,
            evaluatedArgs[i],
            evaluatedArgs[i].has(name),
          ]);
        }
        if (subs.length > 0) result = bindingKeyedSubs(result, subs);
      }

      // Honor a numeric-approximation request (`N(f(2))`) by approximating
      // the (exactly-evaluated) result HERE, while the function's scope
      // frame is still pushed. Approximating after the frame is popped
      // would re-resolve free symbols in the *caller's* dynamic context,
      // breaking lexical scoping (see scope.test.ts "Dynamic scoping").
      //
      // In-frame, though, the pass must not re-resolve those symbols by NAME
      // either — that was Channel C of the name-capture defect: `let a = x + 1;
      // g(x) = a; N(g(5))` gave `6` while `g(5)` gave `x + 1`, because the
      // numeric pass looked `x` up again and found the frame's parameter. Every
      // occurrence that genuinely refers to a parameter has already been
      // replaced by its value (`bindingKeyedSubs`, above), so what remains
      // means its own binding and is resolved as such.
      if (options?.numericApproximation)
        result = evaluateInOwnBindings(ce, result, {
          numericApproximation: true,
        });
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

/** Could this definition satisfy a function-application (operator) position?
 * An operator def always can; a value def can unless its declared type
 * PROVABLY excludes functions (a plain `number`, `string`, collection, …).
 * A value def with an indeterminate type (`unknown`/`any`/`value`) may hold a
 * function literal, so it can. (Inline property checks, not
 * `isValueDef`/`isOperatorDef` from `boxed-expression/utils`, to avoid a
 * dependency cycle.)
 */
function isApplicableDef(def: BoxedDefinition): boolean {
  if ('operator' in def) return true;
  if ('value' in def) {
    const t = (def as { value: BoxedValueDefinition }).value.type;
    if (t.isUnknown) return true;
    const tt = t.type;
    if (tt === 'any' || tt === 'value' || tt === 'unknown') return true;
    return t.matches('function');
  }
  return true;
}

/**
 * Lookup a definition for a symbol in FUNCTION-APPLICATION (operator)
 * position. Like {@link lookup}, but an inner binding that PROVABLY cannot be
 * applied — a value def whose type excludes functions, e.g. a user symbol
 * `N = 85` shadowing the built-in `N` operator — defers to an outer
 * applicable definition of the same name. A bare-symbol reference still
 * resolves to the inner value (`N + 1` is `86`); only the operator position
 * skips it (`N(x)` numericizes). If no applicable definition exists anywhere
 * in the chain, the innermost binding is returned unchanged so the ordinary
 * "not a function" diagnostics still apply.
 */
export function lookupApplicable(
  id: MathJsonSymbol,
  scope: Scope
): undefined | BoxedDefinition {
  console.assert(typeof id === 'string' && id.length > 0);
  let innermost: BoxedDefinition | undefined;
  let currentScope: Scope | null = scope;
  while (currentScope) {
    const def = currentScope.bindings.get(id);
    if (def) {
      if (isApplicableDef(def)) return def;
      innermost ??= def;
    }
    currentScope = currentScope.parent;
  }
  return innermost;
}
