import { isOperatorDef, isValueDef } from './definition-guards.js';
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

import { MACHINE_PRECISION, SMALL_INTEGER } from '../numerics/numeric.js';
import { BigDecimal } from '../../big-decimal/index.js';
import { activeRollbackFrame } from '../inference-rollback.js';
import {
  noteScratchBinding,
  scratchRootOf,
  scratchRootOfBinding,
} from '../scratch-scopes.js';
import { tombstoneBinding } from './binding-tombstone.js';
import {
  effectsContractStateOf,
  recordEffectsTransition,
} from './effects-provenance.js';
import { foldSeed } from '../numerics/random.js';
import { containsSignatureArm } from '../../common/type/utils.js';
import { NumericValue } from '../numeric-value/types.js';
import { ExactNumericValue } from '../numeric-value/exact-numeric-value.js';
import { _BoxedOperatorDefinition } from './boxed-operator-definition.js';
import { _BoxedValueDefinition } from './boxed-value-definition.js';
import { _BoxedExpression } from './abstract-boxed-expression.js';
import { isNumber, isFunction, isSymbol, numericValue } from './type-guards.js';
import { isShadowedSymbol } from '../library-shadowing.js';
import { isImaginaryUnitValue, isRealPartZero } from './imaginary-part.js';
import { functionLiteralParameterName } from './function-literal.js';
import {
  hasProvisionalDependents,
  registerProvisionalDependents,
  repairProvisionalDependents,
  unregisterProvisionalDependent,
} from './provisional-application.js';
import {
  binderBindingOf,
  boundVariableNames,
  boundVariableNamesInOperand,
  markShieldDeclaration,
  rewriteWithBinders,
} from './binders.js';
import { declaredBinders } from './binding-sites.js';
import { sameSyntactic } from './compare.js';

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

/**
 * Box a number that a numeric computation produced.
 *
 * `ce.number()` reads a big decimal as a value given by the host, and makes
 * an integer-valued big decimal exact at any magnitude. The result of a
 * numeric computation is inexact even when it is integer-valued, so it must
 * not take that route. This function keeps it a float, except that a small
 * integer (at most `SMALL_INTEGER` in absolute value) is boxed as an exact
 * integer, as `boxMachineNumber()` in `apply.ts` does for a machine result.
 * Any other value (a JavaScript number, for example) goes to `ce.number()`
 * unchanged.
 */
export function boxBignumResult(
  ce: ComputeEngine,
  value: BigDecimal | number
): Expression {
  // A kernel can return a value of another kind than its declared type (the
  // trigonometric kernels return the boxed `ComplexInfinity` at a pole):
  // `ce.number()` handles it as before.
  if (!(value instanceof BigDecimal)) return ce.number(value);
  if (value.isInteger()) {
    const n = value.toNumber();
    if (Math.abs(n) <= SMALL_INTEGER) return ce.number(n);
  }
  return ce.number(ce._numericValue(value));
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
 * A 128-bit digest of `s`, as 32 lowercase hexadecimal characters: the
 * cyrb128 string hash — four 32-bit lanes mixed per character and finalized
 * against each other. It is a key where `hashCode` is a bucket: on the
 * inputs this engine feeds it (its own serializations, never adversarial
 * text) a collision between distinct inputs is not expected in practice,
 * though no cryptographic bound is claimed. It backs `Expression.digest`;
 * see that contract for what may be assumed of it. Not stable across
 * releases.
 */
export function digest128(s: string): string {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return (
    (h1 >>> 0).toString(16).padStart(8, '0') +
    (h2 >>> 0).toString(16).padStart(8, '0') +
    (h3 >>> 0).toString(16).padStart(8, '0') +
    (h4 >>> 0).toString(16).padStart(8, '0')
  );
}

/**
 * The expressions whose digest must be read fresh on every access because
 * it depends on a MUTABLE object somewhere below them: an object's digest
 * is that of its record snapshot, and a parent that memoized a digest over
 * it would answer the snapshot of the first read after every later store.
 * An object registers itself; a function node or dictionary registers
 * itself when any operand or value is registered. Membership is decided
 * the first time a digest is computed, and a node's operands never change
 * after construction, so it never has to be revisited.
 */
const VOLATILE_DIGEST = new WeakSet<object>();

export function markVolatileDigest(expr: object): void {
  VOLATILE_DIGEST.add(expr);
}

export function hasVolatileDigest(expr: object): boolean {
  return VOLATILE_DIGEST.has(expr);
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

/**
 * The names that occur FREE in `expr`: every symbol occurrence that no
 * `Function` literal on the path from `expr` down to that occurrence binds.
 *
 * `expr.symbols` is the wrong tool for a capture test, because it lists a
 * name bound INSIDE `expr` as well — the `p` of a `Map(p ↦ …, list)` in the
 * body — and a check against an enclosing binder then refuses a body whose
 * only use of the colliding name is under its own lambda, where the lambda's
 * parameter shadows the outer binding and nothing is captured. This walk
 * drops a lambda's parameter names at the literal that binds them, so only
 * the occurrences the enclosing scope can reach are reported. A name that is
 * bound in one branch and free in another is still reported, from the free
 * branch. The parameter operands of a `Function` literal are declarations,
 * not occurrences, and are not walked.
 *
 * Only a `Function` literal shadows. Every other binder — a `Block` local, a
 * `Sum` index, a comprehension variable — keeps its bound name REPORTED, as
 * if free. A lambda's parameter is visible in exactly its body, but a scoped
 * node's bindings are not visible in all of its operands: a comprehension
 * clause reads the OUTER binding of a name a later clause binds, and a
 * `Sum` bound may read the outer binding of its own index. Treating such a
 * name as shadowed would hide the outer reference from a capture test. The
 * conservative answer refuses a substitution that might have been safe; it
 * never admits one that captures.
 */
export function freeSymbolNames(
  expr: Expression,
  acc: Set<string> = new Set()
): Set<string> {
  if (isSymbol(expr)) {
    acc.add(expr.symbol);
    return acc;
  }
  if (!isFunction(expr)) return acc;
  if (expr.operator !== 'Function') {
    for (const op of expr.ops) freeSymbolNames(op, acc);
    return acc;
  }
  const inner = new Set<string>();
  freeSymbolNames(expr.ops[0], inner);
  for (const n of boundVariableNames(expr)) inner.delete(n);
  for (const n of inner) acc.add(n);
  return acc;
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
    // A constant held until a numeric approximation (`Pi`, `ExponentialE`)
    // stays symbolic, as `evaluate()` keeps it: its value is a float, and
    // replacing it turns an exact root such as `ln(3)` into a float and
    // hides the shape `e^(bx)` from the solver.
    if (def.value.holdUntil === 'N') return expr;
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
  // A bound name protects the operands it is IN SCOPE in
  // (`boundVariableNamesInOperand`): an iterator clause's index does not
  // protect an earlier clause's collection or guard, where the name denotes
  // the enclosing binding.
  const bound = boundVariableNames(expr);
  // The clause ordering is read once per node, not once per operand.
  const binders = bound.length ? declaredBinders(expr, 'post') : undefined;
  const protectIn = (i: number): ReadonlySet<string> => {
    if (!bound.length) return protect;
    const here =
      binders === undefined
        ? bound
        : boundVariableNamesInOperand(expr, i, binders);
    return here.length ? new Set([...protect, ...here]) : protect;
  };

  const ops = expr.ops;
  const resolved = ops.map((op, i) =>
    resolveBoundSymbols(op, protectIn(i), seen)
  );
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
  if (index.isComplex) return self;
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

  // The multiple of π is reduced modulo 2 EXACTLY when it is an exact
  // rational, with the sign of `k` kept as `%` keeps it: converting it to a
  // float first rounded it before its product with π, a second rounding
  // that left `sin(30)` in degree mode (the angle `(1/6)·π`) at 21 digits
  // as `0.500…001` where `sin(π/6)` is `0.5`. A radical multiple (`√2·π`)
  // has no exact reduction and takes the float route below.
  let k2: NumericValue;
  if (k instanceof ExactNumericValue && !k.isComplex && k.radical === 1) {
    const half = k.div(2);
    // The sign is read from the exact value: the double of a rational whose
    // denominator overflows (`−1/10³¹⁰`) is `−0`, which is not negative.
    const whole = k.sgn() === -1 ? half.ceil() : half.floor();
    k2 = k.sub(whole.mul(2));
  } else k2 = ce._numericValue(k.bignumRe ? k.bignumRe.mod(2) : k.re % 2);
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

  // The structure is read first, and the numeric value of the expression
  // only at the end: an exact factor (`π/3` in `e^{iπ/3}`) stays exact, and
  // the numeric value of `iπ/3` would give the float `1.047…`.
  if (isNumber(expr))
    return isRealPartZero(expr.numericValue) ? imaginaryPart(expr) : undefined;

  if (isFunction(expr, 'Negate')) return getImaginaryFactor(expr.op1)?.neg();

  if (isFunction(expr, 'Complex')) {
    if (expr.op1.isSame(0) && !isNaN(expr.op2.re))
      return ce.number(expr.op2.re);
    return undefined;
  }

  // A product with exactly one imaginary factor (`i`, or a literal `bi`) and
  // only real factors otherwise: `0.5·i·π` has the factor `0.5·π`. Any
  // number of operands, so that `e^{iπ·0.5}` keeps the exact angle.
  if (isFunction(expr, 'Multiply')) {
    let imaginary: Expression | undefined;
    const rest: Expression[] = [];
    for (const op of expr.ops) {
      const im = isSymbol(op, 'ImaginaryUnit')
        ? ce.One
        : isNumber(op) && isRealPartZero(op.numericValue) && op.isComplex
          ? imaginaryPart(op)
          : undefined;
      if (im !== undefined) {
        if (imaginary !== undefined) return undefined;
        imaginary = im;
      } else if (op.type.matches('real')) rest.push(op);
      else return undefined;
    }
    if (imaginary !== undefined)
      return rest.length === 0
        ? imaginary
        : ce.function('Multiply', [imaginary, ...rest]);
  }

  if (isFunction(expr, 'Divide')) {
    const denom = expr.op2;
    if (denom.isSame(0)) return undefined;
    const factor = getImaginaryFactor(expr.op1);
    if (factor !== undefined) return factor.div(denom);
  }

  if (expr.re === 0) return ce.number(expr.im!);

  return undefined;
}

/** The imaginary part of the number literal `x`: exact (`1/3` for `i/3`)
 * when `x` is exact, else a machine number. */
function imaginaryPart(x: Expression): Expression {
  const ce = x.engine;
  if (isNumber(x) && x.isExact) {
    const json = x.json;
    if (Array.isArray(json) && json[0] === 'Complex') return ce.box(json[2]);
  }
  // An inexact imaginary part held as a big decimal keeps its digits: the
  // double `im` of `1152921504606846977.5` is `1152921504606846976`, which
  // loses the parity of the half-turns in `e^{1152921504606846977.5·iπ}`.
  const nv = isNumber(x) ? x.numericValue : undefined;
  const big = typeof nv === 'object' ? nv.bignumIm : undefined;
  if (big !== undefined) return ce.number(ce._numericValue(big));
  // The imaginary part of a float is a float, even when its value is an
  // integer: the imaginary part of the real float `0.0` is the float `0`,
  // and `e^{0.0}` is then the float `1`. `ce.number(0)` would be the exact 0.
  if (isNumber(x) && !x.isExact)
    return ce.number(ce._inexactNumericValue(x.im));
  return ce.number(x.im);
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

  if (isNumber(expr)) return isImaginaryUnitValue(expr.numericValue);

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
      if (isNumber(v)) return isImaginaryUnitValue(v.numericValue);
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
  // A user binding of the name `Pi` (`ce.declare('Pi', { value: 3 })`) is
  // not π (`isShadowedSymbol()`).
  if (isSymbol(expr, 'Pi') && !isShadowedSymbol(expr))
    return [ce._numericValue(1), ce._numericValue(0)];

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
 * The operator definition that `name` resolves to in the current scope, or
 * `undefined` if `name` is not an operator.
 *
 * A custom `canonical` handler that validates its own operands must read the
 * signature (`.signature.type`) and the positions where an absent operand is
 * stripped (`.stripsMissingAt(i)`) from this definition, not from a copy in
 * the handler. A host can redeclare the operator with a wider signature and
 * keep the handler (`ce.declare(name, { ...def, signature: '...' })`); a copy
 * would then still refuse the operands the new signature admits.
 */
export function declaredOperator(ce: ComputeEngine, name: string) {
  const def = ce.lookupDefinition(name);
  return def !== undefined && 'operator' in def ? def.operator : undefined;
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
 *
 * The name is first looked up in the current scope. When that finds an
 * assigned variable, the symbols of `expr` with this name are also examined:
 * if each one is bound to a constant definition, the name is not an assigned
 * variable of `expr`. Example: after `ce.declare('Pi', { value: 3 })`, the
 * name `Pi` finds the user variable, but `ce.Pi` is still bound to the
 * library constant π. So `ce.Pi.mul(0)` is `0`, and is not held as the
 * product `0·Pi`, whose MathJSON would box again with the user value.
 */
export function hasAssignedVariable(expr: Expression): boolean {
  const ce = expr.engine;
  for (const name of expr.symbols) {
    if (isAssignedVariableName(ce, name) && !isBoundToConstant(expr, name))
      return true;
  }
  return false;
}

/**
 * True when each symbol named `name` in `expr` is bound to a constant
 * definition (the library constant `Pi` of `ce.Pi`). A symbol that is not
 * bound, or is bound to a definition that is not constant, makes it false.
 * The walk goes through the same operands as `expr.symbols`.
 */
function isBoundToConstant(
  expr: Expression,
  name: string,
  visited: Set<Expression> = new Set()
): boolean {
  if (isSymbol(expr))
    return expr.symbol !== name || expr.valueDefinition?.isConstant === true;
  if (!isFunction(expr) || visited.has(expr)) return true;
  visited.add(expr);
  if (expr._numericStore !== undefined) return true;
  return expr.ops.every((op) => isBoundToConstant(op, name, visited));
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
 * Is the value of an assigned symbol named `name` hidden only by the
 * valueless variable of an enclosing binder?
 *
 * Inside the evaluate handler of a binder such as `Integrate`, the innermost
 * binding of the integration variable is the binder's own variable, which
 * has no value, so `isAssignedVariableName` answers `false`. But a read of
 * that name by an occurrence the binder does not own skips the binder's
 * variable and reads the next binding outward (`bindingInContext`,
 * `binders.ts`). A function literal's parameter read outside a call is such
 * an occurrence: compiling `x ↦ |x|` inside `Integrate` with `x := 5` read
 * `x` as positive and dropped the `Abs`. When this function answers `true`,
 * the name needs a shield as much as a directly assigned one does.
 */
function binderHidesAssignedValue(
  ce: Expression['engine'],
  name: string
): boolean {
  let scope: Scope | null = ce.context.lexicalScope;
  while (scope) {
    const found = scope.bindings.get(name);
    if (found !== undefined) {
      if (!('value' in found)) return false;
      const value = found.value.value;
      if (value !== undefined && value !== null)
        return found.value.isConstant !== true;
      if (binderBindingOf(ce, name, scope) === undefined) return false;
    }
    scope = scope.parent;
  }
  return false;
}

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
 * A name is shielded in two cases:
 * - its visible binding carries a user-assigned, non-constant value
 *   (`isAssignedVariableName`);
 * - its visible binding is the valueless variable of an enclosing binder, and
 *   that binder variable hides an outer binding with an assigned value
 *   (`binderHidesAssignedValue`). An occurrence of the name that the binder
 *   does not own, such as a function literal's parameter read outside a
 *   call, skips the binder's variable and reads the outer value.
 *
 * A valueless name that hides no value, or a built-in constant, is not
 * shielded (a constant must not be stripped). When no name is shielded, `fn`
 * runs directly with no scope push, so the common case (no contradictory
 * assignment) has no overhead and cannot change behavior.
 *
 * Re-entrancy is safe: inside the shield, the visible binding of a shielded
 * name is the valueless shield declaration. A shield declaration is not a
 * binder's variable, so neither test above passes for it, and a nested
 * `withValueShield` over the same name finds nothing more to shield.
 */
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
    if (
      !isAssignedVariableName(ce, name) &&
      !binderHidesAssignedValue(ce, name)
    )
      continue;
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
  // A store-backed list (`ce.list()`) holds numbers only: no `Function`
  // literal inside, and reading its `ops` would box every element.
  return (
    isFunction(v) &&
    v._numericStore === undefined &&
    v.ops.some((o: Expression) => o.operator === 'Function')
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
    | BoxedValueDefinition,
  /** The scope that holds the binding record `def`, when the caller knows
   * it: the provisional repair below then skips the definitions that cannot
   * see this binding (`repairProvisionalDependents`), and a binding in a
   * scratch scope is marked as such (`scratch-scopes.ts`). */
  scope?: Scope,
  /** True when the caller is a declaration and the target scope held no
   * binding of `name` before it (`declareSymbolValue`,
   * `declareSymbolOperator`). See the `binding-repair` event below. */
  fresh?: boolean
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

  // A binding under a registered scratch scope (`scratch-scopes.ts`): the
  // target scope is one, or the record was marked when it was declared in
  // one. The update is then a write to a scratch binding, and the halves it
  // constructed are marked too, so a later inference on them is recognized.
  // A half supplied by the caller is not marked: it is installed by identity
  // and can be shared with a binding outside the scratch scope.
  const scratchRoot = scratchRootOf(ce, scope) ?? scratchRootOfBinding(ce, def);
  if (scratchRoot !== undefined)
    noteScratchBinding(scratchRoot, [
      def,
      constructedValueHalf,
      constructedOperatorHalf,
    ]);

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
  // (`provisional-application.ts`). The reverse holds too: a body that APPLIED
  // `name` while it had no definition (`2x(t+1)` reads `x(t+1)` as a call)
  // is re-derived when `name` gains a value that is not a function, and then
  // reads the product. This arm is taken only when the installed value has
  // a KNOWN non-function type and something waits on `name`. An
  // `unknown`-typed placeholder declaration decides nothing, and consuming
  // the waiting definitions on it would lose them before the real definition
  // arrives (Epsil declares a function's name before it installs the body);
  // an ordinary value declaration must not emit a repair event either (the
  // event moves the callable generation).
  const installedNonCallable =
    !callableValue &&
    mutableDef.operator === undefined &&
    installedValue !== undefined &&
    installedValue !== supersededValue &&
    !installedValue.type.isUnknown &&
    hasProvisionalDependents(ce, name);
  if (
    mutableDef.operator !== undefined ||
    callableValue ||
    installedNonCallable
  ) {
    // The swap above is COMMITTED, and the repair below can throw. Bump the
    // generation here rather than relying on the callers' post-`updateDef`
    // bump (`declareSymbolOperator`), which such a throw would skip — leaving
    // generation-keyed caches holding results computed against the definition
    // that is no longer installed.
    // State event: `updateDef`'s own conditional bump is a `binding-repair`
    // emission (design §4) — the CALLERS emit their operation event
    // (`declare`/`redefine`) separately, after this returns.
    // A binding under a scratch scope (`scratch-scopes.ts`) is flagged: its
    // repair advances no version that a cache outliving the scratch
    // computation keys on (`noteStateEvent`).
    //
    // A FRESH declaration is flagged too, and its repair does not advance the
    // definition version. The version is what the memo of a derived
    // signature keys on (`declaredResultMemoKey`), and a fresh declaration
    // cannot change a memoized signature by itself: it swaps no half that a
    // derivation read, because the target scope held no binding of `name`.
    // It can change a memoized signature in only two ways, and each is
    // counted elsewhere. (1) It makes `name` resolve to a new binding from
    // the scopes under the target scope: the memo key counts the
    // declarations made in each scope on the home chain of the function and
    // of its callees (`noteScopeDeclaration`, `calleeHomesDeclarationCount`),
    // and a declaration that shadows a callable binding advances the version
    // through its `declare` event (`shadowsCallable`). (2) It rebuilds a
    // stored literal that waited on `name`: `repairWave`
    // (`function-utils.ts`) advances the version for each literal it
    // installs. Without this, every boxing of a function literal that applies
    // an undeclared name, which declares that name in the literal's own new
    // scope, advanced the version and invalidated every memoized signature:
    // for a chain of functions in which each calls the next twice, the
    // derivations grew exponentially with the length of the chain.
    ce._noteStateEvent({
      kind: 'binding-repair',
      ...(scratchRoot !== undefined ? { scratch: true } : {}),
      ...(fresh === true ? { fresh: true } : {}),
    });
    // The definition installed just now is passed as `justInstalled` so a
    // recursive body — which noted its OWN name while canonicalizing — is not
    // re-derived against itself.
    repairProvisionalDependents(
      ce,
      name,
      mutableDef.operator ?? (callableValue ? installedValue : undefined),
      scope
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

/**
 * The float of the exact value of `expression`, when `value` (the numeric
 * value of `expression`) is a NaN or an infinite number literal at machine
 * precision. Otherwise, `undefined`.
 *
 * At machine precision, the numeric evaluation of each term of a sum gives a
 * double, and the double of an integer above the largest double is ±∞. The
 * sum of the doubles of `[10^{400}, -10^{400}, 1]` is then `∞ - ∞ + 1 = NaN`,
 * while the exact sum is 1. The exact value is computed with `evaluate()`,
 * and its float is the result: 1 here, and +∞ for an exact sum above the
 * largest double. Only a pure `expression` is evaluated again. An engine
 * whose numeric values are big decimals does not have this limit. A finite
 * `value` costs one test.
 */
export function numericFromExactValue(
  ce: ComputeEngine,
  expression: Expression | undefined,
  value: Expression
): Expression | undefined {
  if (!isNumber(value) || value.isFinite === true) return undefined;
  if (expression === undefined || expression.isPure !== true) return undefined;
  if (bignumPreferred(ce)) return undefined;
  const exact = expression.evaluate();
  if (!isNumber(exact) || exact.isNaN === true) return undefined;
  return exact.N();
}

/**
 * The asynchronous form of `numericFromExactValue()`, for the
 * `evaluateAsync` handlers. The exact value is computed with
 * `evaluateAsync()` and `options` (the abort signal and the effect handlers
 * of the evaluation), so that an application that has only an asynchronous
 * handler is evaluated, and the evaluation can be cancelled.
 */
export async function numericFromExactValueAsync(
  ce: ComputeEngine,
  expression: Expression | undefined,
  value: Expression,
  options: Parameters<Expression['evaluateAsync']>[0]
): Promise<Expression | undefined> {
  if (!isNumber(value) || value.isFinite === true) return undefined;
  if (expression === undefined || expression.isPure !== true) return undefined;
  if (bignumPreferred(ce)) return undefined;
  const exact = await expression.evaluateAsync({
    signal: options?.signal,
    _effects: options?._effects,
  });
  if (!isNumber(exact) || exact.isNaN === true) return undefined;
  return exact.N();
}

/**
 * The `canonical` and `evaluate` handlers of the operator definitions in the
 * system scope, whose bindings are `bindings`. `withOwnHead()` reads it to
 * return early for a handler that no library definition holds (the handler
 * of a user operator), which is the common case. Computed once per system
 * scope, and again when the number of its bindings changes.
 */
function libraryHandlers(bindings: {
  readonly size: number;
  values(): Iterable<unknown>;
}): ReadonlySet<unknown> {
  const cached = LIBRARY_HANDLERS.get(bindings);
  if (cached !== undefined && cached.size === bindings.size)
    return cached.handlers;
  const handlers = new Set<unknown>();
  for (const binding of bindings.values()) {
    const def = binding as Parameters<typeof isOperatorDef>[0];
    if (!isOperatorDef(def)) continue;
    if (def.operator.canonical) handlers.add(def.operator.canonical);
    if (def.operator.evaluate) handlers.add(def.operator.evaluate);
  }
  LIBRARY_HANDLERS.set(bindings, { size: bindings.size, handlers });
  return handlers;
}

const LIBRARY_HANDLERS = new WeakMap<
  object,
  { size: number; handlers: ReadonlySet<unknown> }
>();

/**
 * The result of the `canonical` or `evaluate` handler `handler` of an
 * operator definition, called for an operator named `name`, with the head
 * `name` when the handler built its result with the name of the library
 * operator it belongs to.
 *
 * Most library handlers build their result with their own operator name:
 * the `canonical` handler of `Sin` returns `ce._fn('Sin', ops)`, and its
 * `evaluate` handler returns `Sin(x)` for an argument with no exact value. A
 * copy of the definition under another name (`const { name, ...sin } =
 * ce.lookupDefinition('Sin').operator; ce.declare('MySin', sin)`) calls the
 * same handlers, which would turn `MySin(x)` into `Sin(x)`: the copy would
 * lose its head, and with it its own handlers. So when the head of the
 * result is the name of the system-scope (library) definition that holds
 * this same handler under `key`, and that name is not `name`, the result is
 * built again with the head `name` and the same operands.
 *
 * A handler can also rewrite the call into OTHER nodes that contain the
 * library operator: the `canonical` handler of `NotEqual` turns the chain
 * `NotEqual(x, y, z)` into `And(NotEqual(x, y), NotEqual(y, z))`. Each node
 * that the handler built with the name of a system-scope definition that
 * holds this same handler is built again with the head `name`, so
 * `MyNotEqual(x, y, z)` gives `And(MyNotEqual(x, y), MyNotEqual(y, z))`, and
 * the handlers of the copy run on these nodes. `ops()` gives the operands
 * of the call: a part of the result that is the same as an operand
 * (`sameSyntactic()`, which compares the structure and the names, not the
 * bindings, so that a raw operand compares with its canonical form) was not
 * built by the handler, and is
 * kept, also when it is the whole result (the `canonical` handler of `And`
 * returns its single operand: `MyAnd(And(a, b))` gives `And(a, b)`). `ops()`
 * is called only when the result holds a node to rename, and its operands
 * are not canonicalized here: on the lazy route they are the raw operands,
 * and canonicalizing them would declare their free symbols. Without `ops`,
 * only the head of the result is checked.
 *
 * A handler can flatten an operand into the node it builds: the `canonical`
 * handler of `And` turns `And(And(a, b), c)` into `And(a, b, c)`. A node
 * whose operands hold all the operands of a call operand with the head of
 * the library operator is not renamed, since the library node of the user
 * would then be evaluated by the handlers of the copy. When this node is the
 * result, the call is kept unflattened under the name of the copy:
 * `Nand2(And(a, b), c)` gives `Nand2(And(a, b), c)`, with canonical operands
 * (the handler canonicalized them to flatten them). A node below the result
 * keeps the name of the library operator.
 *
 * Keeping the call as written (`MyNotEqual(x, y, z)`) would change its
 * value: the library handlers read a chain of more than two operands of
 * `NotEqual` only in the canonical form, so the evaluation of
 * `NotEqual(1, 2, 1)` as written gives `False`, where the chain
 * `1 ≠ 2 ∧ 2 ≠ 1` is `True`.
 *
 * A result with another head that holds no such node is a rewrite that the
 * handler chose (the `canonical` handler of `Rational` gives a `Divide`, a
 * fold gives a number), and is kept. When the system-scope definition of
 * `name` holds the same handler, the handler is shared by two library
 * operators, and the result is kept as well: its head could be a rewrite
 * from one of them to the other.
 */
export function withOwnHead<T extends Expression | undefined | null>(
  ce: ComputeEngine,
  name: string,
  key: 'canonical' | 'evaluate',
  handler: unknown,
  result: T,
  ops?: () => ReadonlyArray<Expression>
): T {
  if (!result || !isFunction(result) || result.operator === name) return result;
  const bindings = ce.contextStack[0]?.lexicalScope.bindings;
  if (bindings === undefined || !libraryHandlers(bindings).has(handler))
    return result;
  const own = bindings.get(name);
  if (isOperatorDef(own) && own.operator[key] === handler) return result;
  const holdsHandler = (head: string): boolean => {
    const library = bindings.get(head);
    return isOperatorDef(library) && library.operator[key] === handler;
  };
  if (ops === undefined)
    return holdsHandler(result.operator)
      ? (ce._fn(name, result.ops) as T)
      : result;
  // True when `e` or a node below it has the library name of the handler.
  const hasLibraryNode = (e: Expression): boolean =>
    isFunction(e) &&
    ((e.operator !== name && holdsHandler(e.operator)) ||
      e.ops.some(hasLibraryNode));
  if (!hasLibraryNode(result)) return result;
  const operands = ops();
  // True when the operands of `e` hold all the operands of a call operand
  // with the library name: the handler flattened this operand into `e`.
  const flattensOperand = (e: Expression): boolean =>
    isFunction(e) &&
    operands.some(
      (op) =>
        isFunction(op) &&
        op.nops > 0 &&
        holdsHandler(op.operator) &&
        op.ops.every((x) => e.ops.some((y) => sameSyntactic(y, x)))
    );
  if (holdsHandler(result.operator) && flattensOperand(result)) {
    if (operands.some((op) => sameSyntactic(op, result))) return result;
    return ce._fn(
      name,
      operands.map((x) => x.canonical)
    ) as T;
  }
  // The result with the head `name` on each node that the handler built with
  // the library name. The same node object when nothing changed below it.
  const rename = (e: Expression): Expression => {
    if (!isFunction(e) || operands.some((op) => sameSyntactic(op, e))) return e;
    const xs = e.ops.map(rename);
    if (e.operator !== name && holdsHandler(e.operator) && !flattensOperand(e))
      return ce._fn(name, xs);
    return xs.every((x, i) => x === e.ops[i]) ? e : ce._fn(e.operator, xs);
  };
  return rename(result) as T;
}
