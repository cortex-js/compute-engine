import { isValueDef } from './definition-guards.js';
import type {
  Expression,
  OperatorDefinition,
  ValueDefinition,
  IComputeEngine as ComputeEngine,
  BoxedDefinition,
  BoxedOperatorDefinition,
  BoxedValueDefinition,
  DictionaryInterface,
  Scope,
} from '../global-types.js';

import { MACHINE_PRECISION } from '../numerics/numeric.js';
import { activeRollbackFrame } from '../inference-rollback.js';
import { tombstoneBinding } from './binding-tombstone.js';
import {
  effectsContractStateOf,
  recordEffectsTransition,
} from './effects-provenance.js';
import { foldSeed } from '../numerics/random.js';
import { containsSignatureArm } from '../../common/type/utils.js';
import { NumericValue } from '../numeric-value/types.js';
import { _BoxedOperatorDefinition } from './boxed-operator-definition.js';
import { _BoxedValueDefinition } from './boxed-value-definition.js';
import { _BoxedExpression } from './abstract-boxed-expression.js';
import { isNumber, isFunction, isSymbol, numericValue } from './type-guards.js';
import { functionLiteralParameterName } from './function-literal.js';
import {
  registerProvisionalDependents,
  repairProvisionalDependents,
  unregisterProvisionalDependent,
} from './provisional-application.js';
import {
  boundVariableNames,
  markShieldDeclaration,
  rewriteWithBinders,
} from './binders.js';

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
  // A CAPABILITY guard, so it asks against the absence-admitting family top
  // `dictionary<any>`: bare `dictionary` is the values-only
  // `dictionary<unknown>` synonym (user ruling 2026-08-17), and an
  // attributes bag whose entry value types carry an absence arm (a `value`
  // entry typed `range | nothing`, say) is still a dictionary — testing the
  // bare name made `Declare` fail to recognize exactly such a bag and go
  // inert.
  return (
    expr !== null &&
    expr !== undefined &&
    expr instanceof _BoxedExpression &&
    expr.type.matches('dictionary<any>')
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

// The number-set tables live in a leaf module so that the fact index can read
// them without importing this file, which would close a dependency cycle.
export { domainToType } from './number-set-types.js';

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

  // A symbolic angle always takes this early return, so numericizing it first
  // is pure waste — and on a deep tree of user-function applications the walk
  // is exponential in the nesting depth. Ask the cheap question first.
  if (theta.unknowns.length > 0) return theta;
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

  // A symbol IS the imaginary unit when its assigned value resolves to the
  // number i — an EXPLICIT dereference (`.isSame()` is strictly syntactic and
  // never follows a binding), kept so a non-default definition of the
  // imaginary unit still qualifies. Cycle-guarded with a visited-name set
  // (rather than depth-capped) so a valid, merely-long acyclic alias chain
  // is not mistaken for a cycle.
  if (isSymbol(expr)) {
    const visited = new Set<string>([expr.symbol]);
    let v: Expression | undefined = expr.canonical.value;
    while (v !== undefined) {
      if (isNumber(v)) return v.re === 0 && v.im === 1;
      if (!isSymbol(v)) return false;
      if (visited.has(v.symbol)) return false;
      visited.add(v.symbol);
      v = v.value;
    }
    return false;
  }

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

  // No π factor: the whole expression is the `t` term, and it only has one if
  // it numericizes. Gate on `.unknowns` first — `.N()` cannot yield a literal
  // while free variables remain, and the discarded walk is exponential over
  // nested applications. This is `numberLiteralOf()` (`./numerics.ts`) spelled
  // out, because `numerics` imports this module and may not be imported back.
  if (expr.unknowns.length > 0)
    return [ce._numericValue(0), ce._numericValue(0)];

  const nVal = expr.N();
  return [ce._numericValue(0), ce._numericValue(numericValue(nVal) ?? 0)];
}

// The predicate is `OperatorDefinition`, not `Partial<OperatorDefinition>`:
// every member of `OperatorDefinition` is already optional, so `Partial` adds
// nothing.
export function isValidOperatorDef(def: unknown): def is OperatorDefinition {
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

// `isValueDef` lives in `definition-guards.ts` (a leaf module — see there);
// re-exported here so every existing import site is unchanged.
export { isValueDef, isOperatorDef } from './definition-guards.js';

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

function isAssignedVariableName(
  ce: Expression['engine'],
  name: string
): boolean {
  const def = ce.lookupDefinition(name);
  if (!isValueDef(def)) return false;
  if (def.value.value === undefined || def.value.value === null) return false;
  if (def.value.isConstant === true) return false;
  return true;
}

/**
 * Run `fn` with each name in `names` shielded from its assigned value: for the
 * duration of the call, the symbol is shadow-declared VALUELESS (keeping its
 * declared type; in-scope assumptions survive) in a temporary scope.
 *
 * This is the shared mechanism behind the binder convention (ARCHITECTURE.md,
 * "Bound variables, free symbols, and assigned values"): a variable a binder
 * owns (`Solve`/`Integrate`/`Limit`/`D`/`Sum`/…) is a pure symbol, so a
 * same-named global assignment must not leak into the operation OR its result.
 *
 * Only names carrying a USER-ASSIGNED, non-constant value are shielded — a
 * valueless or built-in-constant name needs no shield (and a constant must not
 * be stripped). When none qualify, `fn` runs directly with no scope push, so
 * the common case (no contradictory assignment) has zero overhead and cannot
 * change behavior.
 *
 * Re-entrancy is naturally safe: a shielded symbol no longer reads as assigned,
 * so a nested `withValueShield` over the same name finds nothing to shield.
 */
/**
 * Run `fn` with a `WithRandomSeed` frame seeded by `seed` installed as the
 * innermost frame: for the duration of the call, every `ce._random()` draw is
 * the counter-based `hash(seed, n)` of that frame (§2 of
 * `docs/RANDOMNESS-MODEL.md`).
 *
 * Scoping is DYNAMIC — the frame is active through user-function calls, not
 * just lexically inside `fn` — and frames NEST with the innermost winning.
 * Counters are per-frame, so a nested frame cannot perturb its parent's
 * subsequent draws.
 *
 * The frame is restored in a `finally`: a body that throws must not leak its
 * frame into everything evaluated afterwards.
 *
 * SYNCHRONOUS CALLBACKS ONLY — do not pass an async function. The frame is
 * restored when `fn` RETURNS, not when its result settles, so an async body
 * would resume after the `finally` has already popped the frame: its draws
 * would escape the frame (live, unseeded) while any evaluation interleaved
 * before it would run *inside* the frame. This is the same hazard as the
 * engine's async-eval scope lifetime (ARCHITECTURE.md; an async evaluation
 * holds its scope across the await), and it is why both call sites are sync.
 *
 * Throws if `seed` is not a finite real (callers translate that into a
 * structured error — see `foldSeed`).
 */
export function withRandomSeedFrame<T>(
  ce: ComputeEngine,
  seed: number | string,
  fn: () => T
): T {
  const [seedLo, seedHi] = foldSeed(seed);
  const prevFrame = ce._randomFrame;
  ce._randomFrame = { seedLo, seedHi, next: 0 };
  try {
    return fn();
  } finally {
    ce._randomFrame = prevFrame;
  }
}

/**
 * Run `fn`, and if it BAILS, roll the ambient frame's draw counter back to
 * where it was before the call.
 *
 * The draw-consumption contract (`docs/RANDOMNESS-MODEL.md` §5) promises that
 * an operation which returns an error or stays symbolic consumes **zero**
 * draws. Most of the family gets that for free — validation completes before
 * the first draw — but a few paths can only discover failure AFTER drawing:
 * a lazy view that shrinks between the count and the access makes `at()` (or
 * the position pick) return `undefined`, and the operator then returns
 * `undefined` with the counter already advanced, shifting every later draw in
 * the frame.
 *
 * A bail is: `undefined` (stay symbolic), an `Error` expression, or a throw.
 * Anything else is a success and keeps whatever the body consumed.
 *
 * Inert (a direct call) when no frame is active: an unframed draw consumes no
 * counter, so there is nothing to roll back.
 *
 * SYNCHRONOUS CALLBACKS ONLY, for the same reason as `withRandomSeedFrame`.
 */
export function withDrawRollback<T>(ce: ComputeEngine, fn: () => T): T {
  const frame = ce._randomFrame;
  if (frame === undefined) return fn();
  // Capture the object, not just `ce._randomFrame`: a nested frame installed
  // by `fn` restores this same object on the way out, and it is THIS frame's
  // counter that must be rolled back.
  const next = frame.next;
  let result: T;
  try {
    result = fn();
  } catch (e) {
    frame.next = next;
    throw e;
  }
  if (
    result === undefined ||
    isFunction(result as unknown as Expression, 'Error')
  )
    frame.next = next;
  return result;
}

export function withValueShield<T>(
  ce: ComputeEngine,
  names: Iterable<string>,
  fn: () => T
): T {
  const shielded: { name: string; type: string }[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (!isAssignedVariableName(ce, name)) continue;
    // Capture the declared type as a STRING; passing the BoxedType object to
    // `declare` throws "type invalid".
    shielded.push({ name, type: ce.box(name).type.toString() });
  }
  if (shielded.length === 0) return fn();

  ce.pushScope();
  const shieldScope = ce.context.lexicalScope;
  let result: T;
  try {
    for (const { name, type } of shielded) {
      // Skip an exotic type that fails to round-trip through `declare` rather
      // than aborting the whole operation: a rare value leak is better than a
      // thrown evaluation.
      try {
        ce.declare(name, { type });
        // Mark it as a SHIELD: the dereference defers to the ambient lookup
        // for a shielded name (`evaluateInOwnBindings`, `binders.ts`), which
        // is what makes the shadow actually hide the value.
        markShieldDeclaration(shieldScope, name);
      } catch {
        /* leave this symbol unshadowed */
      }
    }
    result = fn();
  } finally {
    ce.popScope();
  }
  // The shadow bindings are dead now that the scope is popped: re-bind any the
  // result still points at, so it denotes the caller's symbols (see
  // `rebindEscaping`). Done AFTER the pop so `ce.symbol()` resolves outward.
  return isExpression(result)
    ? (rebindEscaping(result, shieldScope) as T)
    : result;
}

/**
 * Re-bind the free symbols of an escaping result away from a scope that is
 * being discarded.
 *
 * A temporary scope (the value shield, a call frame) shadow-declares a name so
 * the work inside sees a pure symbol. The RESULT then escapes still pointing
 * at that shadow binding — which is dead the moment the scope pops. That was
 * invisible while symbols compared by name; with binding-aware equality it
 * makes the result compare unequal to the same expression written outside
 * (`HoldValues(Simplify(Abs(w)))` vs `w`). It is a latent defect either way:
 * an expression must not reference a discarded binding.
 *
 * Only occurrences bound BY `scope` are re-bound; a symbol referring to any
 * other scope is left exactly as it is — that is what keeps a stored value's
 * free symbols from being captured. Occurrences bound by a binder INSIDE
 * `expr` (a returned lambda's own parameters) are skipped too: they are
 * self-contained and re-binding them would corrupt the closure.
 *
 * MUST be called after the scope has been popped, so `ce.symbol()` resolves
 * against the enclosing scope.
 */
export function rebindEscaping(expr: Expression, scope: Scope): Expression {
  if (scope.bindings.size === 0) return expr;
  return rewriteWithBinders(expr, (sym, shadowed) => {
    const name = sym.symbol;
    // An occurrence bound by a binder INSIDE `expr` is self-contained: leave
    // a returned closure's own parameters alone.
    if (shadowed?.has(name)) return sym;
    const def = sym.valueDefinition;
    if (def === undefined) return sym;
    const binding = scope.bindings.get(name);
    // Only a symbol pointing at THIS scope's binding is re-bound.
    if (binding === undefined || !isValueDef(binding) || binding.value !== def)
      return sym;
    return sym.engine.symbol(name);
  });
}

/**
 * Re-bind a result escaping the scope that is currently on top of the eval
 * stack — the evaluate-time counterpart of {@link rebindEscaping}.
 *
 * A binder whose `scoped` flag names its binding sites owns a `localScope`,
 * which `BoxedFunction._computeValue` pushes as an eval frame while the
 * evaluate handler runs. Its bound variable is a DIFFERENT variable from the
 * ambient one of the same name, so a result that is an open expression in it —
 * `Series`' expansion is an expression in the ambient `x`, unlike a `Sum`,
 * which is closed over its index — must be re-bound on the way out or it
 * references a binding of a frame that is about to be popped.
 *
 * Call from inside the frame: the enclosing scope is pushed for the rewrite so
 * `ce.symbol()` resolves outward, exactly as `withValueShield` does after its
 * own pop.
 */
export function rebindEscapingCurrentScope(
  ce: ComputeEngine,
  expr: Expression
): Expression {
  const scope = ce.context.lexicalScope;
  if (scope.bindings.size === 0) return expr;
  return ce._inScope(scope.parent ?? undefined, () =>
    rebindEscaping(expr, scope)
  );
}

/**
 * The integrand of an `Integrate`, lifted out of its `Function` literal's
 * `Block`.
 *
 * Both `antiderivative()` and an integration provider (the Rubi driver) unwrap
 * the `Function`/`Block` scaffolding and work on the bare integrand — while
 * minting their own occurrences of the integration variable and of the
 * integrand's free coefficients with `ce.symbol(…)`, i.e. in the CALLER's
 * scope. But the literal's Block scope binds all of them (a coefficient `a` is
 * auto-declared there when the body is canonicalized), so the lifted body and
 * the minted symbols would denote DIFFERENT bindings of the same name: the
 * arithmetic then declines to combine them (measured inside the Rubi driver,
 * where `Product.mul` stopped folding `x·x` and whole rule families went
 * inert), the answer compares unequal to the same expression written by the
 * caller (`∫ x² dx` no longer `isSame` `x³/3`), and — since stage 13 — the
 * matcher's `case 'var'` stops recognizing the integration variable at all.
 *
 * So the lift re-binds, exactly as `lambdaFromLiteral` does for a Jacobian's
 * body — see §Escaping results in
 * `docs/SCOPING-MODEL.md`. A body that is
 * not a single-statement Block is handed over untouched; the callers unwrap
 * whatever they are given.
 *
 * EVERY route that hands an integrand to `ce._integrationProvider` or to
 * `antiderivative()` must lift first, or it silently disagrees with the real
 * run (`explain('Integrate')` did).
 */
export function liftIntegrand(literal: Expression): Expression {
  if (!isFunction(literal, 'Function')) return literal;
  const body = literal.op1;
  if (!isFunction(body, 'Block') || body.nops !== 1) return literal;
  const scope = body.localScope;
  if (!scope) return literal;
  return rebindEscaping(body.op1, scope);
}

/**
 * Is this definition callable-shaped for state-event classification
 * (`docs/EFFECTS-MODEL.md` §4): it has an
 * operator half, its value type carries a signature arm anywhere (deep —
 * the R1 list-of-callbacks shape), or its stored value is (or contains one
 * level down) a `Function` literal.
 */
export function defIsCallableShaped(def: BoxedDefinition | undefined): boolean {
  if (def === undefined) return false;
  if ('operator' in def) return true;
  if (!('value' in def)) return false;
  if (containsSignatureArm(def.value.type?.type)) return true;
  const v = def.value.value;
  if (v === undefined) return false;
  if (v.operator === 'Function') return true;
  return (
    isFunction(v) && v.ops.some((o: Expression) => o.operator === 'Function')
  );
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

  // The halves this update is about to replace. They must leave the
  // forward-reference registry with the record, or every redefinition of
  // `name` strands the superseded definition object — and the literal and raw
  // operands it holds — in every dependents set it had joined
  // (`provisional-application.ts`).
  const supersededValue = mutableDef.value;
  const supersededOperator = mutableDef.operator;

  // A value definition CONSTRUCTED by this call (as opposed to one the
  // caller passed in already boxed). Only such a half is disposed by the
  // rollback journal below: it is frame-created by construction, so
  // releasing its resources (a constant's configuration-change
  // subscription) cannot affect anything that outlives the frame — whereas
  // a caller-supplied definition object may pre-exist the frame and be
  // shared. The same constructed-vs-supplied discriminator gates the
  // provenance-history transfer below, for the same non-ownership reason.
  let constructedValueHalf: _BoxedValueDefinition | undefined;
  let constructedOperatorHalf: _BoxedOperatorDefinition | undefined;

  // Construct BEFORE swapping the record's halves: the definition
  // constructors validate and can throw (a registration conflict, a violated
  // effect contract). Deleting first left the record with NEITHER `value` nor
  // `operator` on a failed update, and applying the symbol then crashed in
  // `makeCanonicalFunction` (`def.operator.scoped` on undefined). A failed
  // update must leave the previous definition in place.
  if (newDef instanceof _BoxedValueDefinition) {
    delete mutableDef.operator;
    mutableDef.value = newDef;
  } else if (isValidValueDef(newDef)) {
    const built = new _BoxedValueDefinition(ce, name, newDef);
    delete mutableDef.operator;
    mutableDef.value = built;
    constructedValueHalf = built;
  } else if (newDef instanceof _BoxedOperatorDefinition) {
    delete mutableDef.value;
    mutableDef.operator = newDef;
  } else if (isValidOperatorDef(newDef)) {
    const built = new _BoxedOperatorDefinition(ce, name, newDef);
    delete mutableDef.value;
    mutableDef.operator = built;
    constructedOperatorHalf = built;
  } else return;

  // Provenance-history survival + the redefinition (W1) effects entry
  // (`docs/EFFECTS-MODEL.md`). A definition
  // object's `_typeProvenance` would otherwise die with it on every
  // reassignment — this call constructs a FRESH half and discards the old
  // one — so a declaring site could never be named after a later
  // redefinition. The installed half ADOPTS the superseded half's history
  // by copy, and an effects-contract transition appends its entry, ONLY
  // when this call constructed the installed half: a caller-supplied,
  // already-boxed half is never written to (it may pre-exist a rollback
  // frame and be shared — mutating it would clobber history it legitimately
  // carries and escape the frame, which restores the record's pointer, not
  // fields on the orphaned instance). Ordered BEFORE the registry calls and
  // the repair cascade below: the cascade can throw with the swap already
  // committed, and the history must not be lost in that case.
  {
    const supersededHalf = supersededValue ?? supersededOperator;
    const installedHalf = constructedValueHalf ?? constructedOperatorHalf;
    if (supersededHalf !== undefined && installedHalf !== undefined) {
      const inherited = supersededHalf._typeProvenance;
      if (inherited !== undefined && inherited.length > 0) {
        // A copy: the superseded object's own array stays untouched, so a
        // rollback frame's restore-by-identity of that object is exact.
        // Transferred entries keep their original `epoch`/`cause`, so
        // nothing inherited can masquerade as "recorded by the pass
        // running now" (the first-boxing predicate compares those).
        installedHalf._typeProvenance = [
          ...inherited,
          ...(installedHalf._typeProvenance ?? []),
        ];
      }
      recordEffectsTransition(
        ce,
        installedHalf,
        effectsContractStateOf(supersededHalf),
        effectsContractStateOf(installedHalf),
        'signature' in installedHalf
          ? installedHalf.signature
          : installedHalf.type,
        // The assigned function literal when the installed half carries
        // one; else the ambient canonicalization cause, when a write
        // already materialized it; else absent (the phase-1 "absent cause
        // is honest" rule).
        ('signature' in installedHalf
          ? installedHalf._lambdaLiteral
          : installedHalf.type.matches('function')
            ? (installedHalf.value ?? undefined)
            : undefined) ??
          ce._inferenceCause?.expr ??
          undefined
      );
    }
  }

  // Rollback journal (family 3, binding-half swaps): re-install the
  // previous half objects on the SAME record, by identity, via the same
  // delete/assign mechanism the swap above used — `sameBindingDef` is
  // object identity (plus one `_activationOf` hop), so restoring fields on
  // the same object is the only identity-safe rollback. Recorded AFTER the
  // swap so a throwing definition constructor journals nothing (a failed
  // update leaves the previous definition in place on its own). The
  // forward-reference registry effects of this update (the unregister/
  // register calls below and in the definition constructors) are journaled
  // by the registry's own hooks (family 5); replaying strictly LIFO keeps
  // the two consistent. The previous half objects still exist — nothing
  // disposes them mid-frame. The installed half is dropped; only a value
  // half this call itself constructed is disposed (see
  // `constructedValueHalf` above), and in debug builds it is tombstoned so
  // a use after the rollback throws with both stacks (the escape rule of
  // `docs/TYPE-SYSTEM.md`).
  const rollbackFrame = activeRollbackFrame(ce);
  if (rollbackFrame !== undefined) {
    const disposable = constructedValueHalf;
    rollbackFrame.record({
      undo: () => {
        if (supersededValue !== undefined) mutableDef.value = supersededValue;
        else delete mutableDef.value;
        if (supersededOperator !== undefined)
          mutableDef.operator = supersededOperator;
        else delete mutableDef.operator;
        if (disposable !== undefined) {
          if (ce._debugBindings)
            tombstoneBinding(disposable, 'rolled-back inference frame');
          disposable.dispose();
        }
      },
    });
  }

  // Checkpoint journal (funnel 3, binding-half swaps): the same undo, on the
  // window rather than the frame. Recorded on the RECORD object under a key
  // of its own, so it is independent of the two halves' field snapshots
  // (funnels 1/2/6, keyed on the half objects) — a window can hold both, and
  // both are needed: the record's pointers and the halves' contents move
  // separately. Disposal of an orphaned constructed half is NOT done here:
  // the restore algorithm collects the constructed halves from the merged
  // windows and disposes each exactly once, after every half restore has run
  // (§6 step 5), because a half orphaned by this entry may be reinstated by
  // an older entry in the same restore.
  const window = ce._checkpointWindow;
  if (window !== undefined) {
    if (window.claim(def, 'binding-halves', 'redefine')) {
      window.push(() => {
        if (supersededValue !== undefined) mutableDef.value = supersededValue;
        else delete mutableDef.value;
        if (supersededOperator !== undefined)
          mutableDef.operator = supersededOperator;
        else delete mutableDef.operator;
      });
    }
    // Noted unconditionally, outside the dedup: only the FIRST swap in a
    // window is journaled, but EVERY half constructed after the window opened
    // is orphaned by a restore through it and has to be disposed. A
    // constructed OPERATOR half is not listed: it has no `dispose()` and holds
    // no subscription to release, and the one place an orphaned one is held
    // strongly — the forward-reference registry — is unwound by that
    // registry's own journal entries.
    if (constructedValueHalf !== undefined)
      window.noteCreated(constructedValueHalf);
  }

  if (supersededValue !== undefined && supersededValue !== mutableDef.value)
    unregisterProvisionalDependent(supersededValue);
  if (
    supersededOperator !== undefined &&
    supersededOperator !== mutableDef.operator
  )
    unregisterProvisionalDependent(supersededOperator);

  // A function-typed VALUE definition is a caller too, and a callee too:
  // `canonicalInvisibleOperator` reads it as an application, so a `Function`
  // literal stored through this route (`ce.declare('g', '(number) -> number')`
  // then `ce.assign('g', …)`) is exactly as order-dependent as one installed as
  // an operator — but only the operator-def constructor registers on its own.
  const installedValue = mutableDef.value;
  let callableValue = false;
  if (installedValue !== undefined && installedValue.type.matches('function')) {
    callableValue = true;
    if (installedValue !== supersededValue)
      registerProvisionalDependents(ce, installedValue.value, installedValue);
  }

  // `name` may now be callable: any definition body that read it as a
  // multiplication operand because it was not callable yet is re-derived here
  // (`provisional-application.ts`).
  if (mutableDef.operator !== undefined || callableValue) {
    // The swap above is COMMITTED, and the repair below can throw. Bump the
    // generation here rather than relying on the callers' post-`updateDef`
    // bump (`declareSymbolOperator`), which such a throw would skip — leaving
    // generation-keyed caches holding results computed against the definition
    // that is no longer installed.
    // State event: `updateDef`'s own conditional bump is a `binding-repair`
    // emission (design §4) — the CALLERS emit their operation event
    // (`declare`/`redefine`) separately, after this returns.
    ce._noteStateEvent({ kind: 'binding-repair' });
    // The definition installed just now is passed as `justInstalled` so a
    // recursive body — which noted its OWN name while canonicalizing — is not
    // re-derived against itself.
    repairProvisionalDependents(
      ce,
      name,
      mutableDef.operator ?? (callableValue ? installedValue : undefined)
    );
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
