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

/** A jet of `n + 1` zero coefficients. */
function zeroJet(n: number): number[] {
  return new Array<number>(n + 1).fill(0);
}

/**
 * A host value entering jet arithmetic. The lowering is real-lane only, so a
 * complex `{re, im}` or a collection reaching a coefficient slot is a value
 * this arithmetic cannot represent: it becomes NaN and propagates, rather
 * than silently producing a number from an object.
 */
function asReal(x: unknown): number {
  return typeof x === 'number' ? x : NaN;
}

/**
 * The coefficients of `a^r` above the constant one, from the ODE
 * `a·w′ = r·a′·w`. The caller supplies the constant coefficient `c0`, that is
 * the branch of `a₀^r` it wants: the principal one for `jpow`, the real root
 * for `jroot`.
 */
function powFrom(a: number[], r: number, c0: number): number[] {
  const m = a.length;
  const c = zeroJet(m - 1);
  c[0] = c0;
  for (let k = 1; k < m; k++) {
    let s = 0;
    for (let j = 1; j <= k; j++) s += (j * r - (k - j)) * a[j] * c[k - j];
    c[k] = s / (k * a[0]);
  }
  return c;
}

/**
 * The sine and cosine jets of `a`, which satisfy a coupled recurrence and are
 * therefore computed together (`Tan` needs both as well).
 */
function jsincos(a: number[]): [number[], number[]] {
  const m = a.length;
  const s = zeroJet(m - 1);
  const c = zeroJet(m - 1);
  s[0] = Math.sin(a[0]);
  c[0] = Math.cos(a[0]);
  for (let k = 1; k < m; k++) {
    let sk = 0;
    let ck = 0;
    for (let j = 1; j <= k; j++) {
      sk += j * a[j] * c[k - j];
      ck += j * a[j] * s[k - j];
    }
    s[k] = sk / k;
    c[k] = -ck / k;
  }
  return [s, c];
}

/**
 * A complex jet: `2·(n + 1)` numbers, the real and imaginary part of each
 * Taylor coefficient interleaved (`c_k` at `[2k]`, `[2k + 1]`). Interleaving
 * keeps one allocation per value, which matters because a jet operation
 * allocates its result.
 */
type ComplexJet = number[];

/** The real part of a host value entering complex jet arithmetic. */
function reOf(x: unknown): number {
  if (typeof x === 'number') return x;
  if (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { re?: unknown }).re === 'number'
  )
    return (x as { re: number }).re;
  return NaN;
}

/** The imaginary part of a host value entering complex jet arithmetic. */
function imOf(x: unknown): number {
  if (typeof x === 'number') return 0;
  if (
    typeof x === 'object' &&
    x !== null &&
    typeof (x as { im?: unknown }).im === 'number'
  )
    return (x as { im: number }).im;
  return NaN;
}

/** A complex jet of `m` coefficients, all zero. */
function zeroComplexJet(m: number): ComplexJet {
  return new Array<number>(2 * m).fill(0);
}

/**
 * The coefficients of `a^r` above the constant one for a complex jet, from
 * the ODE `a·w′ = r·a′·w`. The caller supplies the constant coefficient
 * `c0r + i·c0i`, that is the branch of `a₀^r` it wants.
 */
function cpowFrom(
  a: ComplexJet,
  r: number,
  c0r: number,
  c0i: number
): ComplexJet {
  const m = a.length / 2;
  const c = zeroComplexJet(m);
  const a0r = a[0];
  const a0i = a[1];
  c[0] = c0r;
  c[1] = c0i;
  const d = a0r * a0r + a0i * a0i;
  for (let k = 1; k < m; k++) {
    let sr = 0;
    let si = 0;
    for (let j = 1; j <= k; j++) {
      const w = j * r - (k - j);
      const ar = w * a[2 * j];
      const ai = w * a[2 * j + 1];
      const cr = c[2 * (k - j)];
      const ci = c[2 * (k - j) + 1];
      sr += ar * cr - ai * ci;
      si += ar * ci + ai * cr;
    }
    // Divide by `k · a₀`.
    const qr = sr / k;
    const qi = si / k;
    c[2 * k] = (qr * a0r + qi * a0i) / d;
    c[2 * k + 1] = (qi * a0r - qr * a0i) / d;
  }
  return c;
}

/** The sine and cosine of a complex jet, which satisfy a coupled recurrence. */
function jcsincos(a: ComplexJet): [ComplexJet, ComplexJet] {
  const m = a.length / 2;
  const s = zeroComplexJet(m);
  const c = zeroComplexJet(m);
  const ar = a[0];
  const ai = a[1];
  s[0] = Math.sin(ar) * Math.cosh(ai);
  s[1] = Math.cos(ar) * Math.sinh(ai);
  c[0] = Math.cos(ar) * Math.cosh(ai);
  c[1] = -Math.sin(ar) * Math.sinh(ai);
  for (let k = 1; k < m; k++) {
    let skr = 0;
    let ski = 0;
    let ckr = 0;
    let cki = 0;
    for (let j = 1; j <= k; j++) {
      const jr = j * a[2 * j];
      const ji = j * a[2 * j + 1];
      const i = k - j;
      skr += jr * c[2 * i] - ji * c[2 * i + 1];
      ski += jr * c[2 * i + 1] + ji * c[2 * i];
      ckr += jr * s[2 * i] - ji * s[2 * i + 1];
      cki += jr * s[2 * i + 1] + ji * s[2 * i];
    }
    s[2 * k] = skr / k;
    s[2 * k + 1] = ski / k;
    c[2 * k] = -ckr / k;
    c[2 * k + 1] = -cki / k;
  }
  return [s, c];
}

/**
 * The complex half of the jet runtime. Same recurrences as the real family
 * below, with each coefficient product replaced by a complex one; it is
 * emitted for a body whose own compilation promotes to the complex kernel
 * (an unknown-sign radical or logarithm), so that the two routes agree
 * outside the real domain as well as inside it.
 */
const COMPLEX_JET_HELPERS = {
  jck: (v: unknown, n: number): ComplexJet => {
    const c = zeroComplexJet(n + 1);
    c[0] = reOf(v);
    c[1] = imOf(v);
    return c;
  },
  jcv: (v: unknown, n: number): ComplexJet => {
    const c = zeroComplexJet(n + 1);
    c[0] = reOf(v);
    c[1] = imOf(v);
    if (n >= 1) c[2] = 1;
    return c;
  },
  jcread: (a: ComplexJet, n: number): { re: number; im: number } => {
    let f = 1;
    for (let i = 2; i <= n; i++) f *= i;
    return { re: a[2 * n] * f, im: a[2 * n + 1] * f };
  },
  jcadd: (a: ComplexJet, b: ComplexJet): ComplexJet =>
    a.map((x, k) => x + b[k]),
  jcsub: (a: ComplexJet, b: ComplexJet): ComplexJet =>
    a.map((x, k) => x - b[k]),
  jcneg: (a: ComplexJet): ComplexJet => a.map((x) => -x),
  jcmul: (a: ComplexJet, b: ComplexJet): ComplexJet => {
    const m = a.length / 2;
    const c = zeroComplexJet(m);
    for (let k = 0; k < m; k++) {
      let sr = 0;
      let si = 0;
      for (let i = 0; i <= k; i++) {
        const ar = a[2 * i];
        const ai = a[2 * i + 1];
        const br = b[2 * (k - i)];
        const bi = b[2 * (k - i) + 1];
        sr += ar * br - ai * bi;
        si += ar * bi + ai * br;
      }
      c[2 * k] = sr;
      c[2 * k + 1] = si;
    }
    return c;
  },
  jcsquare: (a: ComplexJet): ComplexJet => COMPLEX_JET_HELPERS.jcmul(a, a),
  /**
   * An INTEGER power, by exponentiation by squaring over jets — defined at a
   * zero of `a`, where the `a^r` recurrence's division by the constant
   * coefficient is not. A negative exponent is the reciprocal jet of the
   * positive power.
   */
  jcipow: (a: ComplexJet, p: number): ComplexJet => {
    const n = a.length / 2 - 1;
    if (p < 0)
      return COMPLEX_JET_HELPERS.jcdiv(
        COMPLEX_JET_HELPERS.jck(1, n),
        COMPLEX_JET_HELPERS.jcipow(a, -p)
      );
    if (p === 0) return COMPLEX_JET_HELPERS.jck(1, n);
    let r = a;
    let e = p;
    let acc: ComplexJet | undefined = undefined;
    while (e > 1) {
      if (e % 2 === 1)
        acc = acc === undefined ? r : COMPLEX_JET_HELPERS.jcmul(acc, r);
      r = COMPLEX_JET_HELPERS.jcmul(r, r);
      e = Math.floor(e / 2);
    }
    return acc === undefined ? r : COMPLEX_JET_HELPERS.jcmul(acc, r);
  },
  jcdiv: (a: ComplexJet, b: ComplexJet): ComplexJet => {
    const m = a.length / 2;
    const c = zeroComplexJet(m);
    const b0r = b[0];
    const b0i = b[1];
    const d = b0r * b0r + b0i * b0i;
    for (let k = 0; k < m; k++) {
      let sr = a[2 * k];
      let si = a[2 * k + 1];
      for (let i = 1; i <= k; i++) {
        const br = b[2 * i];
        const bi = b[2 * i + 1];
        const cr = c[2 * (k - i)];
        const ci = c[2 * (k - i) + 1];
        sr -= br * cr - bi * ci;
        si -= br * ci + bi * cr;
      }
      c[2 * k] = (sr * b0r + si * b0i) / d;
      c[2 * k + 1] = (si * b0r - sr * b0i) / d;
    }
    return c;
  },
  jcpow: (a: ComplexJet, r: number): ComplexJet => {
    const rho = Math.pow(Math.hypot(a[0], a[1]), r);
    const theta = r * Math.atan2(a[1], a[0]);
    return cpowFrom(a, r, rho * Math.cos(theta), rho * Math.sin(theta));
  },
  /**
   * `a^(1/k)` for an ODD integer `k`. A REAL negative constant coefficient
   * takes the real root, which is what the ordinary emitter answers there (it
   * lowers a cube root to `Math.cbrt`, on the real part); anywhere else the
   * principal branch is the one the complex kernel uses.
   */
  jcroot: (a: ComplexJet, k: number): ComplexJet => {
    const r = 1 / k;
    if (a[1] === 0 && a[0] < 0) return cpowFrom(a, r, -Math.pow(-a[0], r), 0);
    const rho = Math.pow(Math.hypot(a[0], a[1]), r);
    const theta = r * Math.atan2(a[1], a[0]);
    return cpowFrom(a, r, rho * Math.cos(theta), rho * Math.sin(theta));
  },
  jcsqrt: (a: ComplexJet): ComplexJet => {
    const m = a.length / 2;
    const c = zeroComplexJet(m);
    const rho = Math.sqrt(Math.hypot(a[0], a[1]));
    const theta = Math.atan2(a[1], a[0]) / 2;
    c[0] = rho * Math.cos(theta);
    c[1] = rho * Math.sin(theta);
    const dr = 2 * c[0];
    const di = 2 * c[1];
    const d = dr * dr + di * di;
    for (let k = 1; k < m; k++) {
      let sr = a[2 * k];
      let si = a[2 * k + 1];
      for (let i = 1; i < k; i++) {
        const xr = c[2 * i];
        const xi = c[2 * i + 1];
        const yr = c[2 * (k - i)];
        const yi = c[2 * (k - i) + 1];
        sr -= xr * yr - xi * yi;
        si -= xr * yi + xi * yr;
      }
      c[2 * k] = (sr * dr + si * di) / d;
      c[2 * k + 1] = (si * dr - sr * di) / d;
    }
    return c;
  },
  jcexp: (a: ComplexJet): ComplexJet => {
    const m = a.length / 2;
    const c = zeroComplexJet(m);
    const e = Math.exp(a[0]);
    c[0] = e * Math.cos(a[1]);
    c[1] = e * Math.sin(a[1]);
    for (let k = 1; k < m; k++) {
      let sr = 0;
      let si = 0;
      for (let i = 1; i <= k; i++) {
        const ar = i * a[2 * i];
        const ai = i * a[2 * i + 1];
        const cr = c[2 * (k - i)];
        const ci = c[2 * (k - i) + 1];
        sr += ar * cr - ai * ci;
        si += ar * ci + ai * cr;
      }
      c[2 * k] = sr / k;
      c[2 * k + 1] = si / k;
    }
    return c;
  },
  jcln: (a: ComplexJet): ComplexJet => {
    const m = a.length / 2;
    const c = zeroComplexJet(m);
    const a0r = a[0];
    const a0i = a[1];
    c[0] = Math.log(Math.hypot(a0r, a0i));
    c[1] = Math.atan2(a0i, a0r);
    const d = a0r * a0r + a0i * a0i;
    for (let k = 1; k < m; k++) {
      let sr = 0;
      let si = 0;
      for (let i = 1; i < k; i++) {
        const cr = i * c[2 * i];
        const ci = i * c[2 * i + 1];
        const ar = a[2 * (k - i)];
        const ai = a[2 * (k - i) + 1];
        sr += cr * ar - ci * ai;
        si += cr * ai + ci * ar;
      }
      const qr = a[2 * k] - sr / k;
      const qi = a[2 * k + 1] - si / k;
      c[2 * k] = (qr * a0r + qi * a0i) / d;
      c[2 * k + 1] = (qi * a0r - qr * a0i) / d;
    }
    return c;
  },
  jcsin: (a: ComplexJet): ComplexJet => jcsincos(a)[0],
  jccos: (a: ComplexJet): ComplexJet => jcsincos(a)[1],
  jctan: (a: ComplexJet): ComplexJet => {
    const [s, c] = jcsincos(a);
    return COMPLEX_JET_HELPERS.jcdiv(s, c);
  },
};

/**
 * The runtime side of the lowering: truncated Taylor-jet arithmetic, injected
 * into compiled JavaScript as part of `_SYS`.
 *
 * A jet is a plain array of `n + 1` Taylor COEFFICIENTS (`c_k = f⁽ᵏ⁾/k!`),
 * not of derivatives — the coefficient form is what makes every recurrence
 * below a convolution with no factorials in it. `jread` converts back at the
 * end.
 *
 * Every recurrence is the standard one for its operation; they were checked
 * against the symbolic derivative's own numeric value before landing (see
 * `test/compute-engine/item-284-derivative-compile-cost.test.ts`).
 */
export const JET_HELPERS = {
  ...COMPLEX_JET_HELPERS,
  /** The jet of a value that does not vary with the differentiation point. */
  jk: (v: unknown, n: number): number[] => {
    const c = zeroJet(n);
    c[0] = asReal(v);
    return c;
  },
  /** The jet of the differentiation variable itself, at the point `v`. */
  jv: (v: unknown, n: number): number[] => {
    const c = zeroJet(n);
    c[0] = asReal(v);
    if (n >= 1) c[1] = 1;
    return c;
  },
  /** The n-th derivative read off a jet: `c_n · n!`. */
  jread: (a: number[], n: number): number => {
    let f = 1;
    for (let i = 2; i <= n; i++) f *= i;
    return a[n] * f;
  },
  jadd: (a: number[], b: number[]): number[] => a.map((x, k) => x + b[k]),
  jsub: (a: number[], b: number[]): number[] => a.map((x, k) => x - b[k]),
  jneg: (a: number[]): number[] => a.map((x) => -x),
  jmul: (a: number[], b: number[]): number[] => {
    const m = a.length;
    const c = zeroJet(m - 1);
    for (let k = 0; k < m; k++) {
      let s = 0;
      for (let i = 0; i <= k; i++) s += a[i] * b[k - i];
      c[k] = s;
    }
    return c;
  },
  jsquare: (a: number[]): number[] => JET_HELPERS.jmul(a, a),
  /**
   * An INTEGER power, by exponentiation by squaring over jets. Jet
   * multiplication is defined at a zero of `a`, where the `a^r` recurrence's
   * division by the constant coefficient is not — and a polynomial's
   * derivatives are defined there. A negative exponent is the reciprocal jet
   * of the positive power, which divides by the constant coefficient only
   * where the value itself is undefined.
   */
  jipow: (a: number[], p: number): number[] => {
    const n = a.length - 1;
    if (p < 0)
      return JET_HELPERS.jdiv(JET_HELPERS.jk(1, n), JET_HELPERS.jipow(a, -p));
    if (p === 0) return JET_HELPERS.jk(1, n);
    let r = a;
    let e = p;
    let acc: number[] | undefined = undefined;
    while (e > 1) {
      if (e % 2 === 1) acc = acc === undefined ? r : JET_HELPERS.jmul(acc, r);
      r = JET_HELPERS.jmul(r, r);
      e = Math.floor(e / 2);
    }
    return acc === undefined ? r : JET_HELPERS.jmul(acc, r);
  },
  jdiv: (a: number[], b: number[]): number[] => {
    const m = a.length;
    const c = zeroJet(m - 1);
    c[0] = a[0] / b[0];
    for (let k = 1; k < m; k++) {
      let s = a[k];
      for (let i = 1; i <= k; i++) s -= b[i] * c[k - i];
      c[k] = s / b[0];
    }
    return c;
  },
  /** `a^r` for a real constant `r`, from the ODE `a·w′ = r·a′·w`. */
  jpow: (a: number[], r: number): number[] => powFrom(a, r, Math.pow(a[0], r)),
  /**
   * `a^(1/k)` for an ODD integer `k`: the REAL root, which for a negative
   * constant coefficient is `−|a₀|^(1/k)`. That is the value the interpreter
   * gives and the value the ordinary emitter gives (it lowers a cube root to
   * `Math.cbrt`), while `Math.pow` of a negative base is NaN. Only the
   * constant coefficient differs from `jpow`: the recurrence holds on this
   * branch too.
   */
  jroot: (a: number[], k: number): number[] => {
    const r = 1 / k;
    return powFrom(a, r, Math.sign(a[0]) * Math.pow(Math.abs(a[0]), r));
  },
  jsqrt: (a: number[]): number[] => {
    const m = a.length;
    const c = zeroJet(m - 1);
    c[0] = Math.sqrt(a[0]);
    for (let k = 1; k < m; k++) {
      let s = a[k];
      for (let i = 1; i < k; i++) s -= c[i] * c[k - i];
      c[k] = s / (2 * c[0]);
    }
    return c;
  },
  jexp: (a: number[]): number[] => {
    const m = a.length;
    const c = zeroJet(m - 1);
    c[0] = Math.exp(a[0]);
    for (let k = 1; k < m; k++) {
      let s = 0;
      for (let i = 1; i <= k; i++) s += i * a[i] * c[k - i];
      c[k] = s / k;
    }
    return c;
  },
  jln: (a: number[]): number[] => {
    const m = a.length;
    const c = zeroJet(m - 1);
    c[0] = Math.log(a[0]);
    for (let k = 1; k < m; k++) {
      let s = 0;
      for (let i = 1; i < k; i++) s += i * c[i] * a[k - i];
      c[k] = (a[k] - s / k) / a[0];
    }
    return c;
  },
  jsin: (a: number[]): number[] => jsincos(a)[0],
  jcos: (a: number[]): number[] => jsincos(a)[1],
  jtan: (a: number[]): number[] => {
    const [s, c] = jsincos(a);
    return JET_HELPERS.jdiv(s, c);
  },
  /**
   * `|a|` away from a zero of `a`: the absolute value is `sign(a₀)·a` there,
   * so every coefficient takes the same sign. At `a₀ = 0` the sign is `0`,
   * which is the value the symbolic route's `Sign(0)` gives as well.
   */
  jabs: (a: number[]): number[] => {
    const g = Math.sign(a[0]);
    return a.map((x) => g * x);
  },
};
