import type {
  Expression,
  OperatorDefinition,
  ValueDefinition,
  IComputeEngine as ComputeEngine,
  BoxedDefinition,
  TaggedValueDefinition,
  TaggedOperatorDefinition,
  BoxedOperatorDefinition,
  BoxedValueDefinition,
  DictionaryInterface,
} from '../global-types.js';

import { MACHINE_PRECISION } from '../numerics/numeric.js';
import { Type } from '../../common/type/types.js';
import { NumericValue } from '../numeric-value/types.js';
import { _BoxedOperatorDefinition } from './boxed-operator-definition.js';
import { _BoxedValueDefinition } from './boxed-value-definition.js';
import { _BoxedExpression } from './abstract-boxed-expression.js';
import { isNumber, isFunction, isSymbol, numericValue } from './type-guards.js';
import { functionLiteralParameterName } from './function-literal.js';

/**
 * Check if an expression contains symbolic transcendental functions of constants
 * (like ln(2), sin(1), etc.) that should not be evaluated numerically.
 *
 * This excludes transcendentals that simplify to exact values, such as:
 * - ln(e) -> 1
 * - sin(0) -> 0
 * - cos(0) -> 1
 */
export function hasSymbolicTranscendental(expr: Expression): boolean {
  const op = expr.operator;
  // Transcendental functions applied to numeric constants
  const transcendentals = [
    'Ln',
    'Log',
    'Log2',
    'Log10',
    'Sin',
    'Cos',
    'Tan',
    'Exp',
  ];
  if (
    transcendentals.includes(op) &&
    isFunction(expr) &&
    expr.op1?.isConstant
  ) {
    // Check if this transcendental simplifies to an exact rational value
    // (e.g., ln(e) = 1, sin(0) = 0). If so, it's not truly a
    // "symbolic transcendental" that needs to be preserved.
    const simplified = expr.simplify();
    // If the simplified result is exact (integer or rational),
    // it doesn't need symbolic preservation
    if (simplified.isRational) {
      return false;
    }
    return true;
  }
  // Recursively check sub-expressions
  if (isFunction(expr)) {
    for (const child of expr.ops) {
      if (hasSymbolicTranscendental(child)) return true;
    }
  }
  return false;
}

export function isDictionary(expr: unknown): expr is DictionaryInterface {
  return (
    expr !== null &&
    expr !== undefined &&
    expr instanceof _BoxedExpression &&
    expr.type.matches('dictionary')
  );
}

export function isExpression(x: unknown): x is Expression {
  return x instanceof _BoxedExpression;
}

function isRecord(x: unknown): x is Record<PropertyKey, unknown> {
  return x !== null && typeof x === 'object';
}

function isIterable(x: unknown): x is Iterable<unknown> {
  return (
    x !== null &&
    x !== undefined &&
    typeof (x as { [Symbol.iterator]?: unknown })[Symbol.iterator] ===
      'function'
  );
}

/**
 * For any numeric result, if `bignumPreferred()` is true, calculate using
 * bignums. If `bignumPreferred()` is false, calculate using machine numbers
 */
export function bignumPreferred(ce: ComputeEngine): boolean {
  return ce.precision > MACHINE_PRECISION;
}

// export function getMeta(expr: Expression): Partial<Metadata> {
//   const result: Partial<Metadata> = {};
//   if (expr.verbatimLatex !== undefined) result.latex = expr.verbatimLatex;
//   if (expr.wikidata !== undefined) result.latex = expr.wikidata;
//   return result;
// }

export function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++)
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0; // | 0 to convert to 32-bit int

  return Math.abs(hash);
}

/**
 * The default unknown/variable for an operator whose variable argument was
 * omitted (`Solve(eq)`, `D(expr)`, `PolynomialDegree(poly)`, …): the single
 * free variable of the expression(s), or `x` when there are several free
 * variables and one of them is `x`. `undefined` when no default can be
 * inferred (no free variable, or several free variables without `x`).
 *
 * Works on lazily-held (non-canonical) operands: `unknowns` resolves symbol
 * definitions by name, not through binding.
 */
export function defaultUnknown(
  ...exprs: ReadonlyArray<Expression>
): string | undefined {
  const names = new Set<string>();
  // The pipe topic placeholder `_` is never a valid unknown: in a deferred
  // pipeline stage (`\rhd Solve` → `Function(Solve(_), _)`) the operand IS
  // the placeholder at canonicalization time. Inferring it would bake `_`
  // into the unknown slot, so applying the stage computes
  // `Solve(expr, expr)` instead of `Solve(expr, x)`. Skipping it defers
  // inference until the topic value has been substituted.
  for (const e of exprs)
    for (const n of e.unknowns) if (n !== '_') names.add(n);
  if (names.size === 1) return names.values().next().value;
  if (names.size > 1 && names.has('x')) return 'x';
  return undefined;
}

/**
 * Operator heads whose evaluation is a pure expression-transformation step:
 * the result is an expression in the same free variables — no symbol-value
 * substitution, no relational collapse.
 *
 * A structural algorithm that *holds* its expression operand (`Solve`,
 * `Integrate`, `Limit`, …) should reduce such a head before running:
 * `Solve(Simplify(eq), x)` means "simplify, then solve", not "solve an
 * expression whose operator is `Simplify`" (which finds no roots). This is
 * how a multi-stage pipeline (`expr |> Simplify |> Solve`) reaches the
 * algorithm.
 *
 * Deliberately NOT included:
 * - `Evaluate` / `N`: they substitute assigned symbol values, which would
 *   replace the very unknown being solved for;
 * - relational/boolean heads: evaluating an `Equal` collapses it to a
 *   boolean before the solver sees it;
 * - `CanonicalForm`: taking `.canonical` already handles it.
 */
const TRANSFORMER_HEADS = new Set([
  'Simplify',
  'Expand',
  'ExpandAll',
  'Factor',
  'Together',
  'Distribute',
  'TrigExpand',
]);

/**
 * Reduce a held (already canonical) operand whose head is an
 * expression-transformer (see `TRANSFORMER_HEADS`) so that a structural
 * algorithm sees the transformed expression rather than the transformer
 * call. Any other expression is returned unchanged.
 */
export function reduceTransformerHead(expr: Expression): Expression {
  return reduceTransformerHeads(inlineLambdaApplications(expr));
}

/**
 * Reduce transformer heads anywhere in `expr`, not only at its root: in
 * `Solve(Simplify(u) = 2, w)` the transformer sits inside the `Equal`, so a
 * root-only check left it opaque and the solve returned `[]`.
 *
 * Recursing is safe for exactly this set — every member rewrites its operand
 * without resolving assigned symbol values, so the unknown survives. That is
 * why `Evaluate`/`N`/`ReplaceAll` are not members.
 *
 * A value-bound `Solve` unknown is shielded upstream (`evaluateSolve` shadow-
 * declares it valueless for the duration of the reduction), so the transformer
 * resolves other bound symbols but leaves the unknown symbolic.
 */
function reduceTransformerHeads(expr: Expression): Expression {
  if (TRANSFORMER_HEADS.has(expr.operator)) return expr.evaluate();
  if (!isFunction(expr)) return expr;

  const ops = expr.ops;
  const reduced = ops.map(reduceTransformerHeads);
  if (reduced.every((op, i) => op === ops[i])) return expr;
  return expr.engine.function(expr.operator, reduced);
}

/**
 * Beta-reduce one application of a user-defined function, or `undefined` if
 * `call` is not such an application.
 *
 * Substitution is **structural** (`.subs` on the lambda body), never
 * `.evaluate()`. Evaluating the call would resolve assigned symbol values —
 * with `x` assigned `5`, `g(x).evaluate()` is `21`, which would turn
 * `Solve(g(x) = 0, x)` into `Solve(21 = 0, x)`. Beta-reduction substitutes the
 * function *body*, so it never touches the unknown.
 */
function betaReduceLambda(call: Expression): Expression | undefined {
  if (!isFunction(call)) return undefined;

  const def = call.operatorDefinition as
    | (BoxedOperatorDefinition & {
        _isLambda?: boolean;
        _lambdaLiteral?: Expression;
      })
    | undefined;
  if (!def?._isLambda) return undefined;

  const literal = def._lambdaLiteral;
  if (!literal || !isFunction(literal, 'Function')) return undefined;

  // `Function(body, param₁, …)`. Decline on an arity mismatch: that is the
  // broadcast/partial-application path, which has its own semantics.
  const params = literal.ops.slice(1);
  if (params.length === 0 || params.length !== call.nops) return undefined;

  const substitution: Record<string, Expression> = {};
  for (let i = 0; i < params.length; i++) {
    // `functionLiteralParameterName` unwraps a `Typed(x, type)` parameter, so
    // a typed function literal (`(x: real) ↦ …`) inlines like a bare one.
    const name = functionLiteralParameterName(params[i]);
    if (!name) return undefined;
    substitution[name] = call.ops[i];
  }

  // Canonicalization wraps a lambda body in a `Block`. A single-statement
  // block is just its statement; a multi-statement body is declined — inlining
  // it would need the block's sequencing and local-scope semantics.
  let body = literal.op1;
  if (isFunction(body, 'Block')) {
    if (body.nops !== 1) return undefined;
    body = body.op1;
  }

  // `subs` is NOT binder-aware (unlike `resolveBoundSymbols` below): it rewrites
  // through inner `Function`/`Block`/`Sum`/… binders blindly. Inlining is only
  // capture-safe when no substituted parameter name is rebound by a binder
  // inside the body, and no argument introduces a symbol that such a binder
  // would capture. When either could happen, decline (leave the application
  // opaque) — value-safe, and strictly better than silently corrupting.
  const binders = collectBinderNames(body);
  if (binders.size > 0) {
    for (const name of Object.keys(substitution)) {
      if (binders.has(name)) return undefined;
      for (const s of substitution[name].symbols)
        if (binders.has(s)) return undefined;
    }
  }

  return body.subs(substitution);
}

/** Every name bound by a binder anywhere within `expr` (its own bound names
 * plus those of every descendant), used to keep lambda inlining capture-safe. */
export function collectBinderNames(
  expr: Expression,
  acc: Set<string> = new Set()
): Set<string> {
  if (!isFunction(expr)) return acc;
  for (const n of boundVariableNames(expr)) acc.add(n);
  for (const op of expr.ops) collectBinderNames(op, acc);
  return acc;
}

/**
 * Inline applications of user-defined functions throughout `expr`.
 *
 * A lazy operator holds its expression operand and takes only `.canonical`,
 * which binds structure without substituting values. A call to a user-defined
 * function therefore arrived as an opaque node that the algorithm could not
 * see into: `Simplify(g(a))` returned `g(a)`, `Integrate(g(t), t)` stayed
 * inert, and — worst — `Solve(g(x) = 0, x)` returned `[]`, which by contract
 * means "proven no solutions".
 *
 * `budget` bounds the TOTAL number of beta-reductions so a self-recursive
 * definition (`fact(n) = … fact(n - 1) …`) cannot loop forever, while a finite
 * self-composition (`g(g(x))` for a non-recursive `g`) still fully expands — an
 * on-path name guard would wrongly stop the inner `g(x)`, leaving `Solve` an
 * opaque `g(x)` it reads as "no solutions". `budget` is a single object shared
 * by reference across every branch of the traversal, so it is one global cap on
 * the TOTAL number of beta-reductions in the whole tree — sibling calls
 * (`g(a) + g(b)`) draw down the same counter rather than each getting a fresh
 * budget. That shared cap is what bounds a self-recursive definition.
 */
// Generous enough that no realistic expression (a wide system of many function
// calls) is capped, low enough that a self-recursive definition terminates
// quickly. Only genuine runaway recursion reaches it.
const MAX_LAMBDA_INLINE = 1000;

function inlineLambdaApplications(
  expr: Expression,
  budget: { n: number } = { n: MAX_LAMBDA_INLINE }
): Expression {
  if (!isFunction(expr)) return expr;

  if (budget.n > 0) {
    const reduced = betaReduceLambda(expr);
    if (reduced !== undefined) {
      budget.n -= 1;
      return inlineLambdaApplications(reduced, budget);
    }
  }

  const ops = expr.ops;
  const inlined = ops.map((op) => inlineLambdaApplications(op, budget));
  if (inlined.every((op, i) => op === ops[i])) return expr;
  return expr.engine.function(expr.operator, inlined);
}

/**
 * Replace symbols bound to a value by that value, except for the names in
 * `protect`.
 *
 * A symbol whose value *contains* the unknown hides it from the solver:
 * `Solve(s = 2, w)` with `s := (9 - w²)/4` saw an equation with no `w` in it
 * and returned `[]` — which by contract means "proven no solutions". A
 * coefficient symbol was already resolved further down the pipeline; only a
 * binding that conceals the unknown was mishandled.
 *
 * Reads the *stored* value (`.value`), never `.evaluate()`: evaluating would
 * resolve the unknown inside that value too (with `w := 7`, `s.evaluate()`
 * would fold `w` away). `protect` holds the unknowns, so the variable being
 * solved for is never substituted, and `seen` stops a self-referential or
 * mutually-referential binding from looping.
 */
export function resolveBoundSymbols(
  expr: Expression,
  protect: ReadonlySet<string>,
  seen: Set<string> = new Set()
): Expression {
  if (isSymbol(expr)) {
    const name = expr.symbol;
    if (protect.has(name) || seen.has(name)) return expr;
    const def = expr.engine.lookupDefinition(name);
    if (!isValueDef(def)) return expr;
    const value = def.value.value;
    if (value === undefined || value === null) return expr;
    seen.add(name);
    const resolved = resolveBoundSymbols(value, protect, seen);
    seen.delete(name);
    return resolved;
  }

  if (!isFunction(expr)) return expr;

  // Binder-awareness: a `Function` literal, `Block`, `Sum`, etc. binds its own
  // variables. Those must NOT be resolved to a same-named GLOBAL value —
  // `Simplify(x ↦ x + 1)` with `x := 5` must stay `x ↦ x + 1`, not corrupt the
  // body's bound `x` into `5`. Extend the protected set with the locally-bound
  // names before descending. (`localScope` covers `Block`/`Sum`/`Product`/…;
  // a `Function`'s parameters live in its operand slots, not its scope.)
  const bound = boundVariableNames(expr);
  const childProtect = bound.length ? new Set([...protect, ...bound]) : protect;

  const ops = expr.ops;
  const resolved = ops.map((op) => resolveBoundSymbols(op, childProtect, seen));
  if (resolved.every((op, i) => op === ops[i])) return expr;
  return expr.engine.function(expr.operator, resolved);
}

/** Names bound by `expr` itself (a binder): its local-scope declarations plus,
 * for a `Function` literal, its parameter symbols. */
function boundVariableNames(expr: Expression): string[] {
  const names: string[] = [];
  if (expr.localScope?.bindings) names.push(...expr.localScope.bindings.keys());
  if (isFunction(expr, 'Function'))
    for (const p of expr.ops.slice(1)) {
      const n = functionLiteralParameterName(p);
      if (n) names.push(n);
    }
  return names;
}

/**
 * Replace `At(List(e₁, …, eₙ), k)` by `e_k` — a purely *structural*
 * projection, applied recursively.
 *
 * The point is to avoid `.evaluate()`. Evaluating an `At` evaluates the picked
 * element too, which substitutes assigned symbol values: with `Y := 5`,
 * `At([Y, 2], 1).evaluate()` is `5`. Inside a held `Solve` equation that would
 * replace the very unknown being solved for. Projection just hands back the
 * operand.
 *
 * Without this, indexing into a computed list hid the unknown from the solver
 * exactly as a value-bound symbol did — `Solve(At([Y, 2], 1) = 5, Y)` returned
 * `[]`, i.e. "proven no solutions".
 *
 * Only a literal `List` with a literal integer index in range is reduced;
 * indices are 1-based and a negative index counts from the end, matching `At`.
 */
export function reduceStructuralIndex(expr: Expression): Expression {
  if (!isFunction(expr)) return expr;

  const ops = expr.ops;
  const reduced = ops.map(reduceStructuralIndex);
  const self = reduced.every((op, i) => op === ops[i])
    ? expr
    : expr.engine.function(expr.operator, reduced);

  if (!isFunction(self, 'At') || self.nops !== 2) return self;

  const list = self.op1;
  if (!isFunction(list, 'List')) return self;

  const index = self.op2;
  if (!isNumber(index)) return self;
  // A complex index (`1 + 2i`) is not a valid list position: decline rather
  // than silently projecting on its real part.
  if (index.im !== 0) return self;
  const k = index.re;
  if (!Number.isInteger(k) || k === 0) return self;

  const n = list.nops;
  const i = k > 0 ? k : n + k + 1;
  if (i < 1 || i > n) return self;

  return list.ops[i - 1];
}

/**
 * Heads that *produce* the expression a transformer is meant to rewrite, and
 * so must be reduced when they appear as a transformer's held operand.
 *
 * `Expand(ReplaceAll(e, x -> a + 1))` means "expand the substituted
 * expression", not "expand a `ReplaceAll` call". The transformers are `lazy`
 * and only take `.canonical` of their operand, so an unreduced producer head
 * reached `expand`/`factor`/`together`, which found no polynomial structure
 * and silently returned it unchanged.
 *
 * Deliberately a *different* set from `TRANSFORMER_HEADS`: that one is reduced
 * by the structural algorithms (`Solve`, `Integrate`, `Limit`), which must not
 * substitute assigned symbol values — `ReplaceAll`'s handler ends in
 * `.evaluate()` and does exactly that, which would replace the very unknown
 * being solved for. A transformer is asked to rewrite a concrete expression
 * and has no such constraint.
 */
const TRANSFORMER_OPERAND_HEADS = new Set([...TRANSFORMER_HEADS, 'ReplaceAll']);

/**
 * Reduce the held operand of an expression transformer (`Expand`, `Factor`,
 * `Together`, `Simplify`, …) so the transformer sees the expression the
 * operand denotes rather than the call that produces it.
 *
 * Applied recursively: a producer head is just as likely to appear *inside*
 * the operand as at its root (`Expand(ReplaceAll(f, …) - ReplaceAll(g, …))`).
 * Only the producer subexpressions are evaluated — every other node is left
 * structurally untouched, so no assigned symbol value is substituted anywhere
 * else in the operand.
 *
 * Applications of user-defined functions are inlined first, so a transformer
 * can see into `Simplify(g(a))`, and symbols bound to a value are resolved, so
 * it can see into `Simplify(v)`.
 *
 * Resolving bindings here is an *argument*-level operation: an operator
 * normally evaluates its arguments, and these transformers are `lazy` only to
 * protect the operand's structure from premature rewriting, not to keep its
 * values symbolic. `Simplify(v)` with `v := (x²-1)/(x-1)` therefore simplifies
 * `v`'s value rather than returning `v` unchanged.
 *
 * This does **not** make `simplify()` itself value-substituting: `.simplify()`
 * on an expression is still value-blind (`(a + 2).simplify()` is `a + 2` even
 * when `a := 5`). Only the operand handed to the operator is resolved.
 */
export function reduceTransformerOperand(expr: Expression): Expression {
  return reduceProducerHeads(
    reduceStructuralIndex(
      resolveBoundSymbols(inlineLambdaApplications(expr), EMPTY_NAME_SET)
    )
  );
}

const EMPTY_NAME_SET: ReadonlySet<string> = new Set<string>();

/**
 * Resolve `expr` to a `List` if it denotes one — inlining a function
 * application (`F(x,y,z)` → its body) and following a symbol bound to a list
 * (`let g = […]`) — WITHOUT substituting any scalar values.
 *
 * Used by `JacobianMatrix` to decide system-vs-gradient on what the operand
 * denotes, without resolving the differentiation variables: with `x := 5` and
 * `g := [x²y, x+y]`, `JacobianMatrix(g, [x,y])` must still differentiate a list
 * of `x`, not of `5`. Unlike `reduceTransformerOperand`, the list elements are
 * left exactly as stored.
 */
export function resolveToList(expr: Expression): Expression {
  const inlined = inlineLambdaApplications(expr);
  if (isFunction(inlined, 'List')) return inlined;
  if (isSymbol(inlined)) {
    const def = inlined.engine.lookupDefinition(inlined.symbol);
    const value = isValueDef(def) ? def.value.value : undefined;
    if (value !== undefined && isFunction(value, 'List')) return value;
  }
  return inlined;
}

function reduceProducerHeads(expr: Expression): Expression {
  if (TRANSFORMER_OPERAND_HEADS.has(expr.operator)) return expr.evaluate();
  if (!isFunction(expr)) return expr;

  const ops = expr.ops;
  const reduced = ops.map(reduceProducerHeads);
  if (reduced.every((op, i) => op === ops[i])) return expr;
  return expr.engine.function(expr.operator, reduced);
}

export function normalizedUnknownsForSolve(
  syms:
    | string
    | Iterable<string>
    | Expression
    | Iterable<Expression>
    | null
    | undefined
): string[] {
  if (syms === null || syms === undefined) return [];
  if (typeof syms === 'string') return [syms];
  if (isExpression(syms))
    return normalizedUnknownsForSolve(isSymbol(syms) ? syms.symbol : undefined);
  if (isIterable(syms)) {
    const result: string[] = [];
    for (const s of syms) {
      if (typeof s === 'string') result.push(s);
      else if (isExpression(s) && isSymbol(s)) result.push(s.symbol);
      else result.push('');
    }
    return result;
  }
  return [];
}

/** Return the local variables in the expression.
 *
 * A local variable is a symbol that is declared with a `Declare`
 * expression in a `Block` expression.
 *
 */
export function getLocalVariables(expr: Expression): string[] {
  if (expr.localScope?.bindings) return [...expr.localScope.bindings.keys()];
  return [];
}

export function domainToType(expr: Expression): Type {
  if (!isSymbol(expr)) return 'unknown';
  // if (expr.symbol === 'Booleans') return 'boolean';
  // if (expr.symbol === 'Strings') return 'string';
  if (expr.symbol === 'Numbers') return 'number';
  if (expr.symbol === 'ComplexNumbers') return 'complex';
  if (expr.symbol === 'ImaginaryNumbers') return 'imaginary';
  if (expr.symbol === 'RealNumbers') return 'real';
  if (expr.symbol === 'RationalNumbers') return 'rational';
  if (expr.symbol === 'Integers') return 'integer';
  return 'unknown';
}

function angleToRadians(x: Expression | undefined): Expression | undefined {
  if (!x) return x;
  const ce = x.engine;
  const angularUnit = ce.angularUnit;
  if (angularUnit === 'rad') return x;

  if (angularUnit === 'deg') x = x.mul(ce.Pi).div(180);
  if (angularUnit === 'grad') x = x.mul(ce.Pi).div(200);
  if (angularUnit === 'turn') x = x.mul(ce.Pi).mul(2);
  return x;
}

/**
 * Return the angle in the range [0, 2π) that is equivalent to the given angle.
 *
 * @param x
 * @returns
 */
export function canonicalAngle(
  x: Expression | undefined
): Expression | undefined {
  if (!x) return x;
  const theta = angleToRadians(x);
  if (!theta) return undefined;

  if (theta.N().im !== 0) return theta;

  const ce = theta.engine;

  // Get k, t such that theta = k * π + t
  const [k, t] = getPiTerm(theta);

  if (k.isZero) return ce.number(t);

  const k2 = ce._numericValue(k.bignumRe ? k.bignumRe.mod(2) : k.re % 2);
  const piMulK2N = ce.Pi.mul(k2).N();
  return ce.number(t.add(numericValue(piMulK2N) ?? 0));
}

/**
 * Return a multiple of the imaginary unit, e.g.
 * - 'ImaginaryUnit'  -> 1
 * - ['Negate', 'ImaginaryUnit']  -> -1
 * - ['Negate', ['Multiply', 3, 'ImaginaryUnit']] -> -3
 * - ['Multiply', 5, 'ImaginaryUnit'] -> 5
 * - ['Multiply', 'ImaginaryUnit', 5] -> 5
 * - ['Divide', 'ImaginaryUnit', 2] -> 0.5
 *
 */
export function getImaginaryFactor(
  expr: number | Expression
): Expression | undefined {
  if (typeof expr === 'number') return undefined;
  const ce = expr.engine;
  if (isSymbol(expr, 'ImaginaryUnit')) return ce.One;

  if (expr.re === 0) return ce.number(expr.im!);

  if (isFunction(expr, 'Negate')) return getImaginaryFactor(expr.op1)?.neg();

  if (isFunction(expr, 'Complex')) {
    if (expr.op1.isSame(0) && !isNaN(expr.op2.re))
      return ce.number(expr.op2.re);
    return undefined;
  }

  if (isFunction(expr, 'Multiply') && expr.nops === 2) {
    const [op1, op2] = expr.ops;
    if (isSymbol(op1, 'ImaginaryUnit')) return op2;
    if (isSymbol(op2, 'ImaginaryUnit')) return op1;

    // c * (bi)
    if (isNumber(op2) && op2.re === 0 && op2.im !== 0) return op1.mul(op2.im!);

    // (bi) * c
    if (isNumber(op1) && op1.re === 0 && op1.im !== 0) return op2.mul(op1.im!);
  }

  if (isFunction(expr, 'Divide')) {
    const denom = expr.op2;
    if (denom.isSame(0)) return undefined;
    return getImaginaryFactor(expr.op1)?.div(denom);
  }

  return undefined;
}

/**
 * `true` if expr is a number with imaginary part 1 and real part 0, or a symbol with a definition
 * matching this. Does not bind expr if a symbol.
 *
 * @export
 * @param expr
 * @returns
 */
export function isImaginaryUnit(expr: Expression): boolean {
  const { engine } = expr;
  // Shortcut: boxed engine imaginary unit
  if (expr === engine.I) return true;

  if (isNumber(expr)) return expr.re === 0 && expr.im === 1;

  // !note: use 'isSame' instead of checking identity with 'I', to account for potential,
  // non-default definition of the imaginary unit
  if (isSymbol(expr)) return expr.canonical.isSame(engine.I);

  // function/string/...
  return false;
}

/*
 * Return k and t such that expr = k * pi + t.
 * If no pi factor is found, or k or t are not numeric values, return [0, 0].
 */
export function getPiTerm(
  expr: Expression
): [k: NumericValue, t: NumericValue] {
  const ce = expr.engine;
  if (isSymbol(expr, 'Pi')) return [ce._numericValue(1), ce._numericValue(0)];

  if (isFunction(expr, 'Negate')) {
    const [k, t] = getPiTerm(expr.ops[0]);
    return [k.neg(), t.neg()];
  }

  if (isFunction(expr, 'Add') && expr.nops === 2) {
    const [k1, t1] = getPiTerm(expr.op1);
    const [k2, t2] = getPiTerm(expr.op2);
    return [k1.add(k2), t1.add(t2)];
  }

  if (isFunction(expr, 'Multiply') && expr.nops === 2) {
    if (isNumber(expr.op1)) {
      const [k, t] = getPiTerm(expr.op2);
      const n = expr.op1.numericValue;
      return [k.mul(n), t.mul(n)];
    }
    if (isNumber(expr.op2)) {
      const [k, t] = getPiTerm(expr.op1);
      const n = expr.op2.numericValue;
      return [k.mul(n), t.mul(n)];
    }
  }

  if (isFunction(expr, 'Divide')) {
    if (isNumber(expr.op2)) {
      const [k1, t1] = getPiTerm(expr.op1);
      const d = expr.op2.numericValue;
      return [k1.div(d), t1.div(d)];
    }
  }

  const nVal = expr.N();
  return [ce._numericValue(0), ce._numericValue(numericValue(nVal) ?? 0)];
}

export function isValidOperatorDef(
  def: unknown
): def is Partial<OperatorDefinition> {
  if (!isRecord(def)) return false;
  if (isExpression(def)) return false;
  if ('signature' in def || 'complexity' in def) {
    if ('constant' in def) {
      throw new Error(
        'Operator definition cannot have a `constant` field and value definition cannot have a `signature` field.'
      );
    }
  }
  if (
    !('evaluate' in def) &&
    !('signature' in def) &&
    !('sgn' in def) &&
    !('complexity' in def) &&
    !('canonical' in def)
  )
    return false;

  if (
    'type' in def &&
    def.type !== undefined &&
    typeof def.type !== 'function'
  ) {
    throw new Error(
      'The `type` field of an operator definition should be a function'
    );
  }
  if ('sgn' in def && def.sgn !== undefined && typeof def.sgn !== 'function') {
    throw new Error(
      'The `sgn` field of an operator definition should be a function'
    );
  }
  return true;
}

export function isValidValueDef(def: unknown): def is Partial<ValueDefinition> {
  if (!isRecord(def)) return false;

  if (isExpression(def)) return false;

  if (
    'value' in def ||
    'constant' in def ||
    'inferred' in def ||
    'subscriptEvaluate' in def
  ) {
    // If the `type` field is a function, it's an operator definition
    if ('type' in def && typeof def.type === 'function') return false;

    if ('signature' in def) {
      throw new Error(
        'Value definition cannot have a `signature` field. Use a `type` field instead.'
      );
    }

    if ('sgn' in def) {
      throw new Error(
        'Value definition cannot have a `sgn` field. Use a `flags.sgn` field instead.'
      );
    }

    return true;
  }

  if (
    'type' in def &&
    def.type !== undefined &&
    typeof def.type !== 'function'
  ) {
    return true;
  }

  if ('description' in def) {
    // A def that carries operator-shaped fields (e.g. a spread of an existing
    // boxed operator definition, `{ ...ce.lookupDefinition('At').operator }`)
    // is not a value definition — let the operator classifier claim it rather
    // than throwing on the missing `type`/`value` field. A bare
    // `{ description }` (no operator-shaped fields) still gets the helpful error.
    if (
      'evaluate' in def ||
      'signature' in def ||
      'canonical' in def ||
      'complexity' in def ||
      ('type' in def && typeof (def as { type: unknown }).type === 'function')
    )
      return false;
    throw new Error('Definitions should have a `type` or `value` field.');
  }

  return false;
}

export function isValueDef(
  def: BoxedDefinition | undefined
): def is TaggedValueDefinition {
  return def !== undefined && 'value' in def;
}

/**
 * Whether `expr` contains a free symbol that carries a USER-ASSIGNED value: a
 * NON-constant symbol with a value (`x` after `assign('x', 5)`), as opposed to
 * a built-in constant (`Pi`, `ExponentialE`).
 *
 * This is the value-blindness gate for `simplify()`'s numeric folds. A
 * subexpression with no free *unknowns* still must NOT be folded to a number
 * when its "constant-ness" comes only from substituting an assigned value:
 * `9 - w²` with `w := 5` must stay symbolic, not become `-72`. `.simplify()`
 * does not resolve assigned values — that is `.evaluate()`'s job. A genuine
 * constant is exempt: folding it is governed by the exactness contract, so
 * `ln(e) -> 1` and `√(1+2) -> √3` still reduce.
 *
 * Reads `def.value.isConstant` (the constness marker on the value definition),
 * so no boxed symbol is allocated per check.
 */
export function hasAssignedVariable(expr: Expression): boolean {
  const ce = expr.engine;
  for (const name of expr.symbols) {
    if (isAssignedVariableName(ce, name)) return true;
  }
  return false;
}

/**
 * The names of the free symbols in `expr` that carry a USER-ASSIGNED value (the
 * same predicate as `hasAssignedVariable`, but returning every matching name).
 * Used by the value-blind `simplify()` seam to shadow-declare these symbols as
 * valueless so their sign/parity fall back to type + assumptions.
 */
export function assignedVariableNames(expr: Expression): string[] {
  const ce = expr.engine;
  const names: string[] = [];
  for (const name of expr.symbols) {
    if (isAssignedVariableName(ce, name)) names.push(name);
  }
  return names;
}

function isAssignedVariableName(ce: Expression['engine'], name: string): boolean {
  const def = ce.lookupDefinition(name);
  if (!isValueDef(def)) return false;
  if (def.value.value === undefined || def.value.value === null) return false;
  if (def.value.isConstant === true) return false;
  return true;
}

export function isOperatorDef(
  def: BoxedDefinition | undefined
): def is TaggedOperatorDefinition {
  return def !== undefined && 'operator' in def;
}

export function updateDef(
  ce: ComputeEngine,
  name: string,
  def: BoxedDefinition,
  newDef:
    | Partial<OperatorDefinition>
    | BoxedOperatorDefinition
    | Partial<ValueDefinition>
    | BoxedValueDefinition
): void {
  const mutableDef = def as {
    value?: BoxedValueDefinition;
    operator?: BoxedOperatorDefinition;
  };

  if (newDef instanceof _BoxedValueDefinition) {
    delete mutableDef.operator;
    mutableDef.value = newDef;
  } else if (isValidValueDef(newDef)) {
    delete mutableDef.operator;
    mutableDef.value = new _BoxedValueDefinition(ce, name, newDef);
  } else if (newDef instanceof _BoxedOperatorDefinition) {
    delete mutableDef.value;
    mutableDef.operator = newDef;
  } else if (isValidOperatorDef(newDef)) {
    delete mutableDef.value;
    mutableDef.operator = new _BoxedOperatorDefinition(ce, name, newDef);
  }
}

export function placeholderDef(
  ce: ComputeEngine,
  name: string
): BoxedDefinition {
  return {
    value: new _BoxedValueDefinition(ce, name, { type: 'function' }),
  };
}
