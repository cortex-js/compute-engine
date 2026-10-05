/**
 * Forward-mode automatic differentiation for a compiled derivative
 * application — `Apply(Derivative(f, n), x)`, the parse of `f''(x)`.
 *
 * The symbolic route differentiates `f`'s body `n` times at COMPILE time and
 * compiles the closed form. That closed form multiplies out: each
 * differentiation applies the chain and product rules to every node of the
 * previous result, so for a composition such as
 * `√(x + √(x + √(x + √(x + x))))` the third derivative is a few hundred
 * kilobytes of MathJSON and takes tens of seconds to build and emit.
 *
 * This module lowers the same application numerically instead. The body is
 * evaluated ONCE in truncated Taylor-jet arithmetic: a value is an array of
 * `n + 1` Taylor coefficients `[c₀, …, c_n]` of the function of the
 * differentiation point, the parameter enters as `[x, 1, 0, …]`, and every
 * operation carries its own coefficient recurrence. The n-th derivative is
 * then `c_n · n!`. The emitted code is a fixed-size expression over the
 * body — it does not grow with `n` — and compiling it costs one walk of the
 * body.
 *
 * The lowering FAILS CLOSED: a head with no coefficient recurrence here
 * declines (returns `undefined`) and the caller keeps the symbolic route. A
 * subexpression that does not mention the parameter is a constant of the
 * differentiation and is compiled by the ordinary emitter, then lifted to a
 * constant jet — so an opaque-but-constant factor does not force a decline.
 *
 * The jet result is a floating-point value, not the closed form evaluated
 * exactly, so it agrees with the symbolic route to within accumulated
 * rounding rather than bit-for-bit. Outside the real domain the two routes
 * agree because the lowering runs the same lane the ordinary emitter would:
 * the complex jet family when the body or the differentiation point promotes,
 * the real root of an odd radical where the ordinary emitter uses
 * `Math.cbrt`. A shape whose jet arithmetic would answer NaN where the
 * symbolic route answers a value declines instead of answering.
 */

import type { Expression } from '../global-types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { functionLiteralParameterName } from '../boxed-expression/function-literal.js';
import { rewriteAngularUnit } from './angular-unit.js';

/**
 * Bodies at or below this many nodes keep the symbolic route. Their closed
 * forms stay small — the second derivative of `x² + 3x + 1` is the literal
 * `2` — and a closed form compiles to faster and more readable code than a
 * jet evaluation does. Above it the closed form is the shape that explodes:
 * the four-deep nested radical that motivated this lowering has a 14-node
 * body, and its third derivative is a 392 KB emitted expression.
 */
const JET_MIN_BODY_NODES = 10;

/**
 * The highest differentiation order this lowering accepts. Reading the n-th
 * derivative off a jet scales the last coefficient by `n!`, and `n!` is
 * `Infinity` in double precision from 171 upward: an exactly zero coefficient
 * would then read as `0 · Infinity`, that is NaN, where the true derivative is
 * zero. Above this limit the application keeps the symbolic route.
 */
const JET_MAX_ORDER = 170;

/** The number of nodes in `expr`, counted up to `cap` (then it stops). */
function nodeCount(expr: Expression, cap: number): number {
  let n = 1;
  if (isFunction(expr))
    for (const op of expr.ops) {
      if (n >= cap) return n;
      n += nodeCount(op, cap - n);
    }
  return n;
}

/**
 * Bodies with more nodes than this take the jet lowering at order ONE as
 * well. A single differentiation pass does not explode, but its closed form
 * still grows with the body — the first derivative of a twenty-deep nested
 * radical is a 376 KB kernel where the jet is 670 B — and past this size the
 * closed form is no longer the small, readable expression that makes the
 * symbolic route worth preferring.
 */
const JET_MIN_BODY_NODES_ORDER_ONE = 40;

/**
 * Whether the jet lowering is preferred over the symbolic closed form for
 * `Derivative(literal, order)`. Order 1 stays symbolic for a body of ordinary
 * size: one differentiation pass never explodes, and its closed form is the
 * exact expression callers expect to see emitted. A large body takes the jet
 * at order 1 too (`JET_MIN_BODY_NODES_ORDER_ONE`).
 */
export function prefersJetDerivative(
  literal: Expression,
  order: number
): boolean {
  if (order < 1) return false;
  if (!isFunction(literal, 'Function')) return false;
  const body = literal.ops[0];
  if (body === undefined) return false;
  const min = order < 2 ? JET_MIN_BODY_NODES_ORDER_ONE : JET_MIN_BODY_NODES;
  return nodeCount(body, min + 1) > min;
}

/**
 * Whether `args` — the operands of an `Apply` — is a derivative application
 * this lowering claims, and with which literal and order.
 *
 * Declines a shape that is not a single-order derivative applied to one
 * argument, a callee that does not resolve to a pure univariate user function
 * literal, and an order or body small enough that the symbolic closed form is
 * the better code. It also declines under the complex discipline: there the
 * value shape of every operand is decided by the discipline, while this
 * lowering picks real or complex jet arithmetic from the body alone, so it
 * steps aside and lets the closed form be compiled the ordinary way.
 *
 * `literalOf` resolves a function SYMBOL to the literal it is defined by; the
 * caller supplies it because the resolution lives in the compiler.
 */
export function jetDerivativeTarget(
  args: ReadonlyArray<Expression>,
  literalOf: (id: string) => Expression | undefined,
  complexMode: boolean
): { literal: Expression; order: number } | undefined {
  if (args.length !== 2) return undefined;
  const callee = args[0];
  if (!isFunction(callee, 'Derivative') || callee.ops.length > 2)
    return undefined;
  if (complexMode) return undefined;
  const order = callee.ops.length === 2 ? Math.floor(callee.ops[1].N().re) : 1;
  if (!Number.isFinite(order)) return undefined;

  const head = callee.ops[0];
  let literal: Expression | undefined;
  if (isFunction(head, 'Function')) literal = head;
  else if (isSymbol(head)) literal = literalOf(head.symbol);
  if (literal === undefined || !literal.isPure) return undefined;
  if (!prefersJetDerivative(literal, order)) return undefined;
  return { literal, order };
}

/**
 * Whether the closed form of a multi-index derivative
 * `Derivative(f, k₁, …, kₙ)` is expected to grow past a useful size. The
 * measure is the one `jetDerivativeTarget` uses for a derivative of a
 * function of one argument (`prefersJetDerivative`): the size of the body of
 * `f` and the order, here the total order `k₁ + … + kₙ`. It is computed from
 * the body BEFORE any differentiation, because the differentiation itself is
 * the cost to avoid: the mixed derivative of order 3 of a four-deep nested
 * radical in two variables takes more than 20 seconds to compute.
 *
 * Only a callee that resolves to a function literal is measured (`literalOf`
 * resolves a function SYMBOL). A library operator has no body, and its
 * derivative keeps the closed form, as for one argument.
 */
export function multiIndexDerivativeTooLarge(
  callee: Expression | undefined,
  literalOf: (id: string) => Expression | undefined
): boolean {
  if (!isFunction(callee, 'Derivative') || callee.ops.length <= 2) return false;
  const head = callee.ops[0];
  let literal: Expression | undefined;
  if (isFunction(head, 'Function')) literal = head;
  else if (isSymbol(head)) literal = literalOf(head.symbol);
  if (literal === undefined) return false;
  let order = 0;
  for (const k of callee.ops.slice(1)) {
    const v = Math.floor(k.N().re);
    if (!Number.isFinite(v)) return false;
    order += v;
  }
  return prefersJetDerivative(literal, order);
}

/** `Block(e)` wrappers a function-literal body carries are transparent here. */
function unwrapBody(expr: Expression): Expression {
  let e = expr;
  while (isFunction(e, 'Block') && e.ops.length === 1) e = e.ops[0];
  return e;
}

/**
 * Emit the jet lowering of `Apply(Derivative(literal, order), arg)`, or
 * `undefined` when some part of the body has no coefficient recurrence here.
 *
 * `compile` is the ordinary target emitter, used for the argument and for
 * every subexpression that does not mention the differentiation parameter.
 */
export function compileJetDerivative(
  literal: Expression,
  order: number,
  arg: Expression,
  compile: (expr: Expression) => string,
  tempVar: () => string,
  isComplexValued: (expr: Expression) => boolean
): string | undefined {
  if (!Number.isInteger(order) || order < 1 || order > JET_MAX_ORDER)
    return undefined;
  if (!isFunction(literal, 'Function') || literal.ops.length !== 2)
    return undefined;
  const param = functionLiteralParameterName(literal.ops[1]);
  if (!param) return undefined;

  // The literal never went through the entry-point angular-unit rewrite (it
  // is an operand of a derivative head, which that pass skips so that
  // symbolic differentiation runs in the engine's angular convention). The
  // jet recurrences below are the RADIAN ones — `_SYS.jsin` calls
  // `Math.sin` — so the body has to be rewritten here, exactly as
  // `compileDerivative` rewrites the closed form it produces.
  const rewritten = rewriteAngularUnit(literal);
  if (!isFunction(rewritten, 'Function')) return undefined;
  const body = unwrapBody(rewritten.ops[0]);

  // Which lane the jets run in has to be the lane the symbolic closed form
  // would have been compiled in: the closed form of `dⁿ/dxⁿ √u` carries the
  // same radicals as `u` does, so it promotes to the complex kernel exactly
  // when the body does. Running real jets under a promoting body would
  // answer NaN outside the radical's real domain where the rest of the
  // compilation answers a complex value.
  //
  // The POINT the derivative is taken at decides the lane as well: the real
  // family reads a coefficient with `asReal`, so a `{re, im}` argument — a
  // real body applied at a complex point — turns the whole jet into NaN
  // before any recurrence runs.
  const p =
    isComplexValued(body) || isComplexValued(arg) ? '_SYS.jc' : '_SYS.j';
  const jetVar = tempVar();
  const code = jetOf(body, param, order, jetVar, compile, p);
  if (code === undefined) return undefined;
  return `((${jetVar}) => ${p}read(${code}, ${order}))(${p}v(${compile(arg)}, ${order}))`;
}

/**
 * The jet expression for `expr`, with the differentiation parameter bound to
 * `jetVar`. Returns `undefined` for a head with no recurrence here.
 */
function jetOf(
  expr: Expression,
  param: string,
  order: number,
  jetVar: string,
  compile: (expr: Expression) => string,
  p: string
): string | undefined {
  // A subexpression free of the parameter is a constant of the
  // differentiation: compile it with the ordinary emitter and lift it to a
  // jet whose higher coefficients are zero. This is also the base case for a
  // number literal and for every free symbol.
  if (!expr.has(param)) return `${p}k(${compile(expr)}, ${order})`;

  if (isSymbol(expr)) return expr.symbol === param ? jetVar : undefined;
  if (!isFunction(expr)) return undefined;

  const ops = expr.ops;
  const sub = (e: Expression): string | undefined =>
    jetOf(e, param, order, jetVar, compile, p);

  switch (expr.operator) {
    case 'Block':
      return ops.length === 1 ? sub(ops[0]) : undefined;

    case 'Add':
      return fold(`${p}add`, ops, sub);

    case 'Negate':
      return ops.length === 1 ? unary(`${p}neg`, ops[0], sub) : undefined;

    case 'Subtract': {
      if (ops.length !== 2) return undefined;
      const a = sub(ops[0]);
      const b = sub(ops[1]);
      if (a === undefined || b === undefined) return undefined;
      return `${p}sub(${a}, ${b})`;
    }

    case 'Multiply':
      return fold(`${p}mul`, ops, sub);

    case 'Divide': {
      if (ops.length !== 2) return undefined;
      const a = sub(ops[0]);
      const b = sub(ops[1]);
      if (a === undefined || b === undefined) return undefined;
      return `${p}div(${a}, ${b})`;
    }

    case 'Square':
      if (ops.length !== 1) return undefined;
      return unary(`${p}square`, ops[0], sub);

    case 'Sqrt':
      return ops.length === 1 ? unary(`${p}sqrt`, ops[0], sub) : undefined;

    case 'Root': {
      // `Root(a, k)` is `a^(1/k)`; only a constant degree has a recurrence
      // here (a degree that depends on the parameter needs the general
      // `a^g` rule, which this lowering declines).
      if (ops.length !== 2 || ops[1].has(param)) return undefined;
      const degree = ops[1].re;
      // The degree has to be a provably REAL constant. `.re` on its own is
      // the real PART of a complex constant, so a degree of `3 + i` would be
      // read as `3` and a different function differentiated.
      if (ops[1].im !== 0) return undefined;
      if (!Number.isFinite(degree) || degree === 0) return undefined;
      // An ODD integer degree has a real root for a negative base — the value
      // both the interpreter and the ordinary emitter (`Math.cbrt`) give —
      // while `Math.pow` of a negative base is NaN. Only the constant
      // coefficient changes: the recurrence comes from `a·w′ = r·a′·w`, which
      // holds on the real branch as well.
      if (
        Number.isInteger(degree) &&
        Math.abs(degree) % 2 === 1 &&
        degree !== 1
      ) {
        const a = sub(ops[0]);
        return a === undefined ? undefined : `${p}root(${a}, ${degree})`;
      }
      return power(ops[0], 1 / degree, sub, p);
    }

    case 'Power': {
      if (ops.length !== 2) return undefined;
      // `e^u` is the exponential, whatever the exponent depends on: CE
      // canonicalizes `e^{…}` to `Power(ExponentialE, …)`, so without this
      // arm every exponential body declined.
      if (isSymbol(ops[0], 'ExponentialE'))
        return unary(`${p}exp`, ops[1], sub);
      // Otherwise only a constant real exponent. A general `a^g` is
      // `exp(g·ln a)`, which needs `a > 0` to stay real — fail closed rather
      // than answer NaN where the symbolic route answers a value.
      if (ops[1].has(param)) return undefined;
      const exponent = ops[1].re;
      // The exponent has to be a provably REAL constant. `.re` on its own is
      // the real PART of a complex constant, so `u^(2 + i)` would be
      // differentiated as `u²`; the jet recurrences take a real exponent
      // only, so a complex one declines.
      if (ops[1].im !== 0) return undefined;
      if (!Number.isFinite(exponent)) return undefined;
      return power(ops[0], exponent, sub, p);
    }

    case 'Exp':
      return ops.length === 1 ? unary(`${p}exp`, ops[0], sub) : undefined;

    case 'Ln':
      return ops.length === 1 ? unary(`${p}ln`, ops[0], sub) : undefined;

    case 'Sin':
      return ops.length === 1 ? unary(`${p}sin`, ops[0], sub) : undefined;

    case 'Cos':
      return ops.length === 1 ? unary(`${p}cos`, ops[0], sub) : undefined;

    case 'Tan':
      return ops.length === 1 ? unary(`${p}tan`, ops[0], sub) : undefined;

    case 'Abs':
      // The scalar absolute value only: `Abs` of a non-number operand is the
      // Euclidean norm, which is not a jet operation. `|z|` of a complex
      // value is not differentiable either, so the complex lane declines it.
      if (ops.length !== 1 || ops[0].isNumber === false) return undefined;
      if (p.endsWith('jc')) return undefined;
      return unary(`${p}abs`, ops[0], sub);

    default:
      return undefined;
  }
}

function unary(
  helper: string,
  op: Expression,
  sub: (e: Expression) => string | undefined
): string | undefined {
  const a = sub(op);
  return a === undefined ? undefined : `${helper}(${a})`;
}

function fold(
  helper: string,
  ops: ReadonlyArray<Expression>,
  sub: (e: Expression) => string | undefined
): string | undefined {
  if (ops.length === 0) return undefined;
  let acc = sub(ops[0]);
  if (acc === undefined) return undefined;
  for (let i = 1; i < ops.length; i++) {
    const next = sub(ops[i]);
    if (next === undefined) return undefined;
    acc = `${helper}(${acc}, ${next})`;
  }
  return acc;
}

/**
 * `base ^ exponent` for a constant real exponent. EVERY integer exponent goes
 * through jet multiplication (`_SYS.jipow`, exponentiation by squaring, and a
 * negative exponent as the reciprocal of the positive power), which stays
 * defined at `base = 0` where a polynomial's derivatives are: the general
 * recurrence in `_SYS.jpow` divides by the base's constant coefficient and so
 * answers NaN there. A fractional exponent keeps `_SYS.jpow`, whose true
 * derivative at a zero of the base is unbounded anyway.
 *
 * A zero exponent declines: `x⁰` canonicalizes to `1` and so never reaches
 * here with the parameter in the base, and the `0⁰ = NaN` convention the
 * interpreter uses is not worth reproducing on a path that cannot be taken.
 */
function power(
  base: Expression,
  exponent: number,
  sub: (e: Expression) => string | undefined,
  p: string
): string | undefined {
  if (exponent === 0) return undefined;
  const a = sub(base);
  if (a === undefined) return undefined;
  if (exponent === 1) return a;
  if (Number.isInteger(exponent)) return `${p}ipow(${a}, ${exponent})`;
  return `${p}pow(${a}, ${exponent})`;
}
