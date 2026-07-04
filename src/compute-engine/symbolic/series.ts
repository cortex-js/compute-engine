import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types';

import { checkDeadline } from '../../common/interruptible';
import { isFunction, isNumber, isSymbol } from '../boxed-expression/type-guards';
import { asSmallInteger } from '../boxed-expression/numerics';
import { differentiate } from './derivative';
import { symbolicLimit } from './limit';
import { trigToExp } from './trig-rewrite';

//
// This module implements `Series` — symbolic Taylor expansion at a regular
// point (or an asymptotic expansion at ±∞) — together with the inert remainder
// head `BigO` and the truncation verb `Normal`.
//
// The mathematics is standard: the coefficient of `(x − x0)^k` in the Taylor
// expansion of `f` is `f⁽ᵏ⁾(x0) / k!`. Two independent engines compute these
// exact coefficients:
//
//   1. `expandViaSeeds` — a dense-coefficient power-series engine. It expands
//      structurally (Add/Multiply/Divide/Power) and, for a function `F(arg)`,
//      composes the Taylor series of `F` (obtained on demand by differentiating
//      the *unary* `F` once per order at the inner constant term — this is the
//      "seed table", generalized to every differentiable unary function) with
//      the series of `arg` (polynomial substitution). This is the standard CAS
//      approach and is fast and precise for the common primitives and their
//      compositions (`e^{sin x}`, `ln(cos x)`, …).
//
//   2. `expandByDerivative` — the always-correct fallback: iterated symbolic
//      differentiation of the whole expression, evaluating each derivative at
//      `x0`. It covers everything the seed engine punts on, notably an
//      *undeclared* `f` (whose coefficients stay symbolic — `f(0) + f′(0)x + …`,
//      itself the textbook statement).
//
// Both engines produce the *unique* Taylor coefficients, so there is no
// correctness divergence; the seed engine is simply the fast path.
//
// A coefficient value that fails to evaluate *finitely* at `x0` (a pole, or an
// essential singularity such as `e^{1/x}` at 0) causes the whole expansion to
// be abandoned — `Series` then stays unevaluated rather than returning a
// partial or wrong expansion. Laurent expansion is Phase 2.
//
// None of these functions are reachable from simplification rules; the `Series`
// operator handler is a lazy transformation verb (like `DSolve`/`TrigExpand`),
// so the internal `.simplify()`/`.evaluate()` calls here are safe.
//

/** Highest order we will ever compute, regardless of the requested `n`. */
const MAX_SERIES_ORDER = 100;

/**
 * How many orders past `n` we compute so we can report the *next nonzero* order
 * in the `BigO` remainder (e.g. `sin` skips the even orders, so the remainder
 * after `n = 5` is `O(x⁷)`, not `O(x⁶)`). Two orders cover the usual even/odd
 * gaps; a larger window is not worth the extra (potentially blow-up-prone)
 * differentiation — a wider gap just falls back to the conservative `O(t^{n+1})`.
 */
const BIGO_LOOKAHEAD = 2;

/** A truncated power series: `coeffs[k]` is the (exact) coefficient of `t^k`. */
type Coeffs = Expression[];

function factorialBig(k: number): bigint {
  let r = 1n;
  for (let i = 2n; i <= BigInt(k); i++) r *= i;
  return r;
}

// ─────────────────────────────────────────────────────────────────────────
//  Dense coefficient-array arithmetic (all truncated to order W = length − 1)
// ─────────────────────────────────────────────────────────────────────────

function zeroCoeffs(ce: ComputeEngine, W: number): Coeffs {
  return Array.from({ length: W + 1 }, () => ce.Zero);
}

function constCoeffs(
  ce: ComputeEngine,
  value: Expression,
  W: number
): Coeffs {
  const c = zeroCoeffs(ce, W);
  c[0] = value;
  return c;
}

// Zero operands are pruned throughout: the engine does not reliably fold
// `0·symbolic` (a `0·∞` guard), so composing with a series that has many zero
// coefficients would otherwise accumulate huge unfolded `0·X` trees.

function addC(ce: ComputeEngine, a: Coeffs, b: Coeffs): Coeffs {
  return a.map((ai, i) => {
    if (ai.isSame(0)) return b[i];
    if (b[i].isSame(0)) return ai;
    return ce.function('Add', [ai, b[i]]);
  });
}

function scaleC(ce: ComputeEngine, k: Expression, a: Coeffs): Coeffs {
  return a.map((ai) =>
    ai.isSame(0) ? ce.Zero : ce.function('Multiply', [k, ai])
  );
}

function mulC(ce: ComputeEngine, a: Coeffs, b: Coeffs, W: number): Coeffs {
  const c = zeroCoeffs(ce, W);
  for (let i = 0; i <= W; i++) {
    const terms: Expression[] = [];
    for (let j = 0; j <= i; j++) {
      if (a[j].isSame(0) || b[i - j].isSame(0)) continue;
      terms.push(ce.function('Multiply', [a[j], b[i - j]]));
    }
    c[i] =
      terms.length === 0
        ? ce.Zero
        : terms.length === 1
          ? terms[0]
          : ce.function('Add', terms);
  }
  return c;
}

function powIntC(
  ce: ComputeEngine,
  base: Coeffs,
  k: number,
  W: number
): Coeffs {
  let result = constCoeffs(ce, ce.One, W);
  for (let i = 0; i < k; i++) result = mulC(ce, result, base, W);
  return result;
}

/**
 * Compose `A(w)` where `A` is given by `outer` (coefficients in `w`) and `w` is
 * a series with *zero constant term*. Evaluated by Horner, truncated to order W.
 */
function composeC(
  ce: ComputeEngine,
  outer: Coeffs,
  w: Coeffs,
  W: number
): Coeffs {
  let result = constCoeffs(ce, outer[W] ?? ce.Zero, W);
  for (let k = W - 1; k >= 0; k--) {
    result = mulC(ce, result, w, W);
    result = addC(ce, result, constCoeffs(ce, outer[k] ?? ce.Zero, W));
  }
  return result;
}

/** Compose an outer coefficient series with an arbitrary inner series (its
 * constant term is subtracted first so the composition variable vanishes at
 * `t = 0`). */
function composeOuter(
  ce: ComputeEngine,
  outer: Coeffs,
  inner: Coeffs,
  W: number
): Coeffs {
  const w = inner.slice();
  w[0] = ce.Zero;
  // Fast path: when the inner series is the identity `t` (the argument is
  // exactly the expansion variable), `A(t) = outer` — skip the Horner loop.
  if (w[1]?.isSame(1) && w.every((c, i) => i === 1 || c.isSame(0)))
    return outer.slice(0, W + 1);
  return composeC(ce, outer, w, W);
}

// ─────────────────────────────────────────────────────────────────────────
//  Seed table: Taylor coefficients of a unary function around a point
// ─────────────────────────────────────────────────────────────────────────

/**
 * The exact Taylor coefficients `F⁽ᵏ⁾(b0)/k!` of a unary function `F` around the
 * point `b0`, computed by differentiating the single-variable `F` symbolically.
 * Returns `null` if `F` cannot be differentiated or is singular at `b0`.
 */
/** The hyperbolic functions, whose special values (`cosh 0 = 1`, `sinh 0 = 0`)
 * the engine does not reduce under `evaluate`. Their derivatives are cheap via
 * the derivative table, but a residual `cosh(0)`-style value is reduced by
 * rewriting it to exponential form (`e^0 = 1`) — see `unaryTaylor`. */
const HYPERBOLIC = new Set(['Sinh', 'Cosh', 'Tanh', 'Sech', 'Csch', 'Coth']);

function unaryTaylor(
  ce: ComputeEngine,
  op: string,
  b0: Expression,
  W: number
): Coeffs | null {
  // A plain (non-wildcard) symbol that does not occur in `b0`. A leading
  // underscore would collide with the `_` hole convention in the
  // differentiation machinery, so it must be avoided.
  const v = freshSymbol(b0, op);
  const reduceHyp = HYPERBOLIC.has(op);
  let g: Expression = ce.function(op, [ce.symbol(v)]).canonical;
  const coeffs: Coeffs = [];
  for (let k = 0; k <= W; k++) {
    checkDeadline(ce._deadline);
    let val = g.subs({ [v]: b0 }).evaluate();
    // The engine leaves e.g. `cosh(0)` unreduced; force it through the
    // exponential form so the coefficient is a clean number.
    if (reduceHyp && !isNumber(val)) val = trigToExp(val).evaluate();
    if (!val || !val.isValid) return null;
    // Defer only on a genuine singularity (pole / essential singularity). An
    // unknown *symbolic* value (e.g. `f(0)` for an undeclared `f`) reports
    // `isFinite === false` yet is not infinite — it must be kept.
    if (val.isNaN === true || val.isInfinity === true) return null;
    coeffs.push(ce.function('Divide', [val, ce.number(factorialBig(k))]));
    if (k < W) {
      const gd = differentiate(g, v);
      if (gd === undefined) return null;
      g = gd.canonical;
      if (g.isSame(0)) {
        for (let j = k + 1; j <= W; j++) coeffs.push(ce.Zero);
        break;
      }
    }
  }
  return coeffs;
}

/** The binomial series coefficients of `(base)^a` around `base0 ≠ 0`, i.e. the
 * Taylor coefficients `C(a,k)·base0^{a−k}` of `y^a` around `base0`. */
function powerOuter(
  ce: ComputeEngine,
  a: Expression,
  base0: Expression,
  W: number
): Coeffs | null {
  if (base0.isSame(0)) return null; // branch point — Phase 2
  const outer: Coeffs = [];
  for (let k = 0; k <= W; k++) {
    // C(a,k) = ∏_{i=0}^{k-1} (a − i) / k!
    const factors: Expression[] = [];
    for (let i = 0; i < k; i++)
      factors.push(ce.function('Subtract', [a, ce.number(i)]));
    const binom =
      factors.length === 0
        ? ce.One
        : ce.function('Divide', [
            ce.function('Multiply', factors),
            ce.number(factorialBig(k)),
          ]);
    const pow = ce.function('Power', [
      base0,
      ce.function('Subtract', [a, ce.number(k)]),
    ]);
    const c = ce.function('Multiply', [binom, pow]).evaluate();
    if (!c.isValid || c.isFinite === false) return null;
    outer.push(c);
  }
  return outer;
}

/** Reciprocal `1/b` of a series `b` with nonzero constant term. */
function reciprocalC(ce: ComputeEngine, b: Coeffs, W: number): Coeffs | null {
  const b0 = b[0];
  if (b0.isSame(0)) return null; // pole — Phase 2
  // Taylor of 1/y around b0: a_k = (−1)^k / b0^{k+1}
  const outer: Coeffs = [];
  for (let k = 0; k <= W; k++) {
    const num = k % 2 === 0 ? ce.One : ce.NegativeOne;
    const c = ce
      .function('Divide', [num, ce.function('Power', [b0, ce.number(k + 1)])])
      .evaluate();
    if (!c.isValid || c.isFinite === false) return null;
    outer.push(c);
  }
  return composeOuter(ce, outer, b, W);
}

// ─────────────────────────────────────────────────────────────────────────
//  Seed engine: structural expansion + composition
// ─────────────────────────────────────────────────────────────────────────

function expandViaSeeds(
  expr: Expression,
  x: string,
  x0: Expression,
  ce: ComputeEngine,
  W: number
): Coeffs | null {
  checkDeadline(ce._deadline);

  if (isNumber(expr)) return constCoeffs(ce, expr, W);

  if (isSymbol(expr)) {
    if (expr.symbol === x) {
      const c = zeroCoeffs(ce, W);
      c[0] = x0;
      if (W >= 1) c[1] = ce.One;
      return c;
    }
    // A symbol independent of x (a constant or free parameter).
    return constCoeffs(ce, expr, W);
  }

  if (!isFunction(expr)) return null;

  // A subexpression independent of x is a constant coefficient.
  if (!expr.has(x)) return constCoeffs(ce, expr, W);

  const op = expr.operator;
  const ops = expr.ops;

  switch (op) {
    case 'Add': {
      let acc = zeroCoeffs(ce, W);
      for (const t of ops) {
        const s = expandViaSeeds(t, x, x0, ce, W);
        if (!s) return null;
        acc = addC(ce, acc, s);
      }
      return acc;
    }
    case 'Negate': {
      const s = expandViaSeeds(ops[0], x, x0, ce, W);
      return s ? scaleC(ce, ce.NegativeOne, s) : null;
    }
    case 'Subtract': {
      const a = expandViaSeeds(ops[0], x, x0, ce, W);
      const b = expandViaSeeds(ops[1], x, x0, ce, W);
      if (!a || !b) return null;
      return addC(ce, a, scaleC(ce, ce.NegativeOne, b));
    }
    case 'Multiply': {
      let acc = constCoeffs(ce, ce.One, W);
      for (const t of ops) {
        const s = expandViaSeeds(t, x, x0, ce, W);
        if (!s) return null;
        acc = mulC(ce, acc, s, W);
      }
      return acc;
    }
    case 'Divide': {
      const a = expandViaSeeds(ops[0], x, x0, ce, W);
      const b = expandViaSeeds(ops[1], x, x0, ce, W);
      if (!a || !b) return null;
      const r = reciprocalC(ce, b, W);
      return r ? mulC(ce, a, r, W) : null;
    }
    case 'Power':
      return powerSeries(expr, x, x0, ce, W);
    case 'Root': {
      const m = asSmallInteger(ops[1]);
      if (m === null || m === 0) return null;
      const bs = expandViaSeeds(ops[0], x, x0, ce, W);
      if (!bs) return null;
      const outer = powerOuter(ce, ce.number(1).div(ce.number(m)), bs[0], W);
      return outer ? composeOuter(ce, outer, bs, W) : null;
    }
    default:
      if (ops.length === 1) {
        const inner = expandViaSeeds(ops[0], x, x0, ce, W);
        if (!inner) return null;
        const outer = unaryTaylor(ce, op, inner[0], W);
        return outer ? composeOuter(ce, outer, inner, W) : null;
      }
      return null;
  }
}

function powerSeries(
  expr: Expression,
  x: string,
  x0: Expression,
  ce: ComputeEngine,
  W: number
): Coeffs | null {
  if (!isFunction(expr)) return null;
  const [base, expo] = expr.ops;
  const baseHasX = base.has(x);
  const expHasX = expo.has(x);

  if (!baseHasX && !expHasX) return constCoeffs(ce, expr, W);

  if (baseHasX && !expHasX) {
    const bs = expandViaSeeds(base, x, x0, ce, W);
    if (!bs) return null;
    const k = asSmallInteger(expo);
    if (k !== null && k >= 0) return powIntC(ce, bs, k, W);
    if (k !== null && k < 0) {
      const p = powIntC(ce, bs, -k, W);
      return reciprocalC(ce, p, W);
    }
    // Non-integer constant exponent: binomial series around base0 ≠ 0.
    const outer = powerOuter(ce, expo, bs[0], W);
    return outer ? composeOuter(ce, outer, bs, W) : null;
  }

  // The exponent depends on x: base^{expo} = exp(expo·ln base). For base = e
  // this is just exp(expo) — use it directly, since `ln(e)` does not reduce to
  // 1 in the engine and would pollute the coefficients.
  const g0 = base.isSame(ce.E)
    ? expo
    : ce.function('Multiply', [expo, ce.function('Ln', [base])]);
  const inner = expandViaSeeds(g0, x, x0, ce, W);
  if (!inner) return null;
  const outer = unaryTaylor(ce, 'Exp', inner[0], W);
  return outer ? composeOuter(ce, outer, inner, W) : null;
}

// ─────────────────────────────────────────────────────────────────────────
//  Fallback engine: iterated differentiation of the whole expression
// ─────────────────────────────────────────────────────────────────────────

/**
 * Iterated differentiation of `expr` with respect to `varName`, evaluating each
 * derivative at `at`. `resolve` supplies a value when direct substitution is
 * non-finite (used for the ±∞ expansion, where a coefficient is a limit).
 * Returns `null` (defer) on a genuine singularity.
 */
function expandByDerivative(
  expr: Expression,
  varName: string,
  at: Expression,
  ce: ComputeEngine,
  W: number,
  resolve?: (g: Expression, k: number) => Expression | null
): Coeffs | null {
  let g = expr.canonical;
  const coeffs: Coeffs = [];
  for (let k = 0; k <= W; k++) {
    checkDeadline(ce._deadline);
    let val: Expression | undefined = g.subs({ [varName]: at }).evaluate();
    if (
      !val ||
      !val.isValid ||
      val.isNaN === true ||
      val.isInfinity === true
    ) {
      val = resolve ? resolve(g, k) ?? undefined : undefined;
      if (!val) return null;
    }
    coeffs.push(ce.function('Divide', [val, ce.number(factorialBig(k))]));
    if (k < W) {
      const gd = differentiate(g, varName);
      if (gd === undefined) return null;
      g = gd.canonical;
      if (g.isSame(0)) {
        for (let j = k + 1; j <= W; j++) coeffs.push(ce.Zero);
        break;
      }
    }
  }
  return coeffs;
}

// ─────────────────────────────────────────────────────────────────────────
//  Assembly
// ─────────────────────────────────────────────────────────────────────────

/** True if `expr` is a polynomial in `x` (so a finite expansion is exact). */
function isPolynomialInVar(expr: Expression, x: string): boolean {
  if (isNumber(expr)) return true;
  if (isSymbol(expr)) return true;
  if (!isFunction(expr)) return false;
  const op = expr.operator;
  if (op === 'Add' || op === 'Multiply' || op === 'Subtract' || op === 'Negate')
    return expr.ops.every((o) => isPolynomialInVar(o, x));
  if (op === 'Power') {
    const k = asSmallInteger(expr.ops[1]);
    return k !== null && k >= 0 && isPolynomialInVar(expr.ops[0], x);
  }
  return !expr.has(x);
}

/**
 * Build the result expression from the coefficient array. `power(k)` produces
 * the k-th basis expression (`(x − x0)^k`, or `x^{−k}` at ∞). `exact` is true
 * when the expansion is known to terminate (a polynomial), in which case no
 * `BigO` remainder is emitted.
 */
function assemble(
  ce: ComputeEngine,
  coeffs: Coeffs,
  n: number,
  W: number,
  power: (k: number) => Expression,
  exact: boolean
): Expression {
  const terms: Expression[] = [];
  for (let k = 0; k <= n && k < coeffs.length; k++) {
    const c = coeffs[k];
    if (c.isSame(0)) continue;
    if (k === 0) {
      terms.push(c);
    } else {
      const p = power(k);
      terms.push(c.isSame(1) ? p : ce.function('Multiply', [c, p]));
    }
  }

  if (!exact) {
    // The BigO remainder is at the next nonzero order past n; if none is found
    // within the lookahead window, fall back to the conservative O(t^{n+1}).
    let m = n + 1;
    for (let k = n + 1; k <= W && k < coeffs.length; k++) {
      if (!coeffs[k].isSame(0)) {
        m = k;
        break;
      }
    }
    terms.push(ce.function('BigO', [power(m)]));
  }

  if (terms.length === 0) return ce.Zero;
  return terms.length === 1 ? terms[0] : ce.function('Add', terms);
}

// ─────────────────────────────────────────────────────────────────────────
//  Top-level entry points
// ─────────────────────────────────────────────────────────────────────────

function taylorCoeffs(
  f: Expression,
  x: string,
  x0: Expression,
  ce: ComputeEngine,
  W: number
): Coeffs | null {
  return (
    expandViaSeeds(f, x, x0, ce, W) ?? expandByDerivative(f, x, x0, ce, W)
  );
}

/** A fresh symbol name not equal to `avoid` and not occurring free in `f`. */
function freshSymbol(f: Expression, avoid: string): string {
  for (const name of ['t', 's', 'u', 'w', 'q', 'z', 'tau', 'xi']) {
    if (name !== avoid && !f.has(name)) return name;
  }
  return '_seriesT';
}

/**
 * Compute the series expansion of `f` in the variable `x` about `x0` to order
 * `n` (the highest retained power). Returns the expansion expression, or
 * `undefined` if the expansion cannot be computed (a pole, essential
 * singularity, or non-differentiable operand), in which case the caller leaves
 * `Series(...)` unevaluated.
 */
export function computeSeries(
  f: Expression,
  x: string,
  x0: Expression,
  n: number,
  ce: ComputeEngine
): Expression | undefined {
  n = Math.max(0, Math.min(n, MAX_SERIES_ORDER));
  const W = Math.min(n + BIGO_LOOKAHEAD, MAX_SERIES_ORDER);

  // Expansion at ±∞: substitute x = 1/s and expand at s = 0⁺ (or 0⁻).
  if (x0.isInfinity) {
    const re = x0.re;
    if (!(re === Infinity || re === -Infinity)) return undefined; // ~∞ unsigned
    return seriesAtInfinity(f, x, re > 0 ? 1 : -1, n, W, ce);
  }

  // A non-finite, non-±∞ point (NaN, unsigned ∞): cannot expand.
  if (x0.isNaN) return undefined;

  const coeffs = taylorCoeffs(f, x, x0, ce, W);
  if (!coeffs) return undefined;

  const xExpr = ce.symbol(x);
  const t = x0.isSame(0)
    ? xExpr
    : ce.function('Subtract', [xExpr, x0]);
  const power = (k: number): Expression =>
    k === 1 ? t : ce.function('Power', [t, ce.number(k)]);

  const exact = isPolynomialInVar(f, x) && allZeroBeyond(coeffs, n, W);
  return assemble(ce, coeffs, n, W, power, exact);
}

function allZeroBeyond(coeffs: Coeffs, n: number, W: number): boolean {
  for (let k = n + 1; k <= W && k < coeffs.length; k++)
    if (!coeffs[k].isSame(0)) return false;
  return true;
}

function seriesAtInfinity(
  f: Expression,
  x: string,
  sign: number,
  n: number,
  W: number,
  ce: ComputeEngine
): Expression | undefined {
  const s = freshSymbol(f, x);
  // g(s) = f(1/s); simplify to expose rational cancellations (e.g.
  // (x+1)/x → 1 + s). Safe here (top-level verb, not a simplification rule).
  const g = f
    .subs({ [x]: ce.function('Divide', [ce.One, ce.symbol(s)]) })
    .simplify();

  // Coefficients are evaluated at s = 0. When direct substitution is
  // non-finite, the coefficient is a one-sided limit: c_0 is lim_{x→±∞} f, and
  // higher coefficients are limits of the substituted derivatives from the
  // correct side (s → 0⁺ for +∞, s → 0⁻ for −∞).
  const resolve = (gk: Expression, k: number): Expression | null => {
    if (k === 0) {
      const inf = sign > 0 ? ce.PositiveInfinity : ce.NegativeInfinity;
      const L = symbolicLimit(f, x, inf, undefined, ce);
      if (L && L.isFinite !== false && L.isValid) return L;
    }
    const L2 = symbolicLimit(gk, s, ce.Zero, sign, ce);
    return L2 && L2.isFinite !== false && L2.isValid ? L2 : null;
  };

  const coeffs = expandByDerivative(g, s, ce.Zero, ce, W, resolve);
  if (!coeffs) return undefined;

  const xExpr = ce.symbol(x);
  // Map s^k back to x^{−k}.
  const power = (k: number): Expression =>
    ce.function('Power', [xExpr, ce.number(-k)]);

  const exact = isPolynomialInVar(g, s) && allZeroBeyond(coeffs, n, W);
  return assemble(ce, coeffs, n, W, power, exact);
}

// ─────────────────────────────────────────────────────────────────────────
//  Normal — strip BigO remainder terms
// ─────────────────────────────────────────────────────────────────────────

/**
 * Remove every `BigO(...)` term from `expr`, yielding the compilable/plottable
 * truncated polynomial. Idempotent; a passthrough on `BigO`-free input.
 */
export function normalStrip(expr: Expression): Expression {
  const ce = expr.engine;
  if (isFunction(expr, 'BigO')) return ce.Zero;
  if (isFunction(expr)) {
    return ce.function(
      expr.operator,
      expr.ops.map((op) => normalStrip(op))
    );
  }
  return expr;
}
