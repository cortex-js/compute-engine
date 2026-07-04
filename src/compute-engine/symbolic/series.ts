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
import { getFunctionProperties } from '../function-properties';

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
// When a coefficient value fails to evaluate *finitely* at `x0` the Taylor
// engines above give up (return `null`); the expansion is then retried by the
// **Laurent engine** (`expandLaurent`, Phase 2), a valuation-tagged version of
// the same dense-array arithmetic. A Laurent series `t^v · (c_0 + c_1 t + …)`
// (with `v < 0` for a pole of order `−v`) has a *finite principal part*, so the
// engine can carry it exactly. This covers meromorphic singularities — a pole
// of `g/h` (`1/sin x`, `cot x`, `1/(x²(1−x))`, `tan` at `π/2`), the special
// functions `Gamma`/`Digamma`/`Zeta` at their poles (leading Laurent data from
// closed-form generating series), and poles at `±∞` (via the `t = 1/x` path).
// Genuinely non-meromorphic points still defer: an essential singularity
// (`e^{1/x}` at 0) or a branch point (`ln x`, `√x` at 0) leaves `Series(...)`
// unevaluated rather than returning a partial or wrong expansion.
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
//  Laurent engine (valuation-tagged coefficient arithmetic)
// ─────────────────────────────────────────────────────────────────────────
//
// A `Laurent` value is `t^v · (c[0] + c[1]·t + …)`: `c[i]` is the (exact)
// coefficient of `t^{v+i}`, and `v` (which may be negative) is the index of the
// first stored coefficient. `hi` is the highest power for which the coefficient
// is *complete* — every power `p ≤ hi` is fully known; powers above `hi` are
// unknown (they become the `BigO` remainder). A regular expansion has `hi = W`;
// a special function whose closed-form Laurent data is truncated (e.g. `Zeta`
// at 1, of which only the residue and constant term are elementary) has a
// smaller `hi`, and that boundary propagates through the arithmetic so the
// remainder is never overstated.

interface Laurent {
  v: number;
  c: Coeffs;
  hi: number;
}

/** Coefficient of `t^p` in `L` (Zero outside the stored window). */
function coeffAt(ce: ComputeEngine, L: Laurent, p: number): Expression {
  const i = p - L.v;
  return i >= 0 && i < L.c.length ? L.c[i] : ce.Zero;
}

/** The valuation (lowest power with a nonzero coefficient), or `null` if every
 * stored coefficient is zero. */
function trueVal(L: Laurent): number | null {
  for (let i = 0; i < L.c.length; i++)
    if (!L.c[i].isSame(0)) return L.v + i;
  return null;
}

function lConst(ce: ComputeEngine, value: Expression, W: number): Laurent {
  return { v: 0, c: constCoeffs(ce, value, W), hi: W };
}

/** A Taylor series (valuation ≥ 0) as a Laurent value. */
function lFromTaylor(c: Coeffs, hi: number): Laurent {
  return { v: 0, c, hi };
}

/** A Laurent value with valuation ≥ 0 as a dense Taylor array of length W+1. */
function laurentToTaylor(ce: ComputeEngine, L: Laurent, W: number): Coeffs {
  const c: Coeffs = [];
  for (let k = 0; k <= W; k++) c.push(coeffAt(ce, L, k));
  return c;
}

function addLaurent(
  ce: ComputeEngine,
  a: Laurent,
  b: Laurent,
  W: number
): Laurent {
  const v = Math.min(a.v, b.v);
  const c: Coeffs = [];
  for (let p = v; p <= W; p++) {
    const ai = coeffAt(ce, a, p);
    const bi = coeffAt(ce, b, p);
    c.push(
      ai.isSame(0)
        ? bi
        : bi.isSame(0)
          ? ai
          : ce.function('Add', [ai, bi])
    );
  }
  return { v, c, hi: Math.min(a.hi, b.hi) };
}

function scaleLaurent(ce: ComputeEngine, k: Expression, a: Laurent): Laurent {
  return {
    v: a.v,
    c: a.c.map((ai) => (ai.isSame(0) ? ce.Zero : ce.function('Multiply', [k, ai]))),
    hi: a.hi,
  };
}

function mulLaurent(
  ce: ComputeEngine,
  a: Laurent,
  b: Laurent,
  W: number
): Laurent {
  const v = a.v + b.v;
  const len = Math.max(0, W - v + 1);
  const terms: Expression[][] = Array.from({ length: len }, () => []);
  for (let i = 0; i < a.c.length; i++) {
    if (a.c[i].isSame(0)) continue;
    for (let j = 0; j < b.c.length; j++) {
      if (b.c[j].isSame(0)) continue;
      const idx = i + j + (a.v + b.v) - v; // = i + j
      if (idx >= len) break; // powers only grow with j
      terms[idx].push(ce.function('Multiply', [a.c[i], b.c[j]]));
    }
  }
  const c = terms.map((t) =>
    t.length === 0 ? ce.Zero : t.length === 1 ? t[0] : ce.function('Add', t)
  );
  // Completeness: power p is complete iff every needed a_i (i ≤ p − val(b)) is
  // known (p ≤ a.hi + val(b)) and every needed b_j is known (p ≤ b.hi + val(a)).
  const la = trueVal(a);
  const lb = trueVal(b);
  const hi =
    la === null || lb === null
      ? W
      : Math.min(a.hi + lb, b.hi + la, W);
  return { v, c, hi };
}

function powLaurent(
  ce: ComputeEngine,
  base: Laurent,
  k: number,
  W: number
): Laurent {
  let result = lConst(ce, ce.One, W);
  for (let i = 0; i < k; i++) result = mulLaurent(ce, result, base, W);
  return result;
}

/** `1/b` to upper power `W`. The caller must have expanded `b` to a high enough
 * order that its unit part reaches `W + val(b)` (see `reciprocalOfExpr`). */
function reciprocalLaurent(
  ce: ComputeEngine,
  b: Laurent,
  W: number
): Laurent | null {
  const m = trueVal(b);
  if (m === null) return null; // 1/0
  // Unit part U (Taylor, U[0] = coeff of t^m ≠ 0). `1/b = t^{-m}·(1/U)`, and to
  // reach power W in the result we need 1/U to index W + m.
  const targetIdx = Math.max(0, W + m);
  const U: Coeffs = [];
  for (let k = 0; k <= targetIdx; k++) U.push(coeffAt(ce, b, m + k));
  const recU = reciprocalC(ce, U, targetIdx);
  if (!recU) return null;
  return { v: -m, c: recU, hi: Math.min(b.hi - 2 * m, W) };
}

// ─────────────────────────────────────────────────────────────────────────
//  Special-function pole data
// ─────────────────────────────────────────────────────────────────────────
//
// Closed-form leading Laurent data for the meromorphic special functions,
// computed from their generating series so the coefficients stay exact and
// symbolic. The pole *location* is gated on the analytic-property store's
// `Poles` record (the same store `residue`/`applyPoleOverride` consult); the
// coefficient *data* lives here, because the store records only the pole set,
// not Laurent coefficients.

const SPECIAL_POLE_FNS = new Set(['Gamma', 'Digamma', 'Zeta']);

/** Confirm `point` is a recorded pole of `op` per the analytic-property store. */
function isRecordedPole(
  ce: ComputeEngine,
  op: string,
  point: Expression
): boolean {
  const poles = getFunctionProperties(ce, op)?.poles;
  if (!poles) return false;
  try {
    return (
      ce.function('Element', [point, poles]).evaluate().valueOf() === true
    );
  } catch {
    return false;
  }
}

/** The Taylor series (as an expression in a fresh variable) of `ln Γ(1+u)`,
 * i.e. `−γ·u + Σ_{k≥2} (−1)^k ζ(k)/k · u^k`, truncated to degree `deg`. */
function lnGammaShiftExpr(
  ce: ComputeEngine,
  u: Expression,
  deg: number
): Expression {
  const terms: Expression[] = [
    ce.function('Multiply', [ce.function('Negate', [ce.symbol('EulerGamma')]), u]),
  ];
  for (let k = 2; k <= deg; k++) {
    const coeff = ce.function('Multiply', [
      ce.function('Divide', [ce.number(k % 2 === 0 ? 1n : -1n), ce.number(k)]),
      ce.function('Zeta', [ce.number(k)]),
    ]);
    terms.push(
      ce.function('Multiply', [coeff, ce.function('Power', [u, ce.number(k)])])
    );
  }
  return ce.function('Add', terms);
}

/**
 * The regular part `R(u)` of `Γ(x)` near its pole `x = −n`, as an expression in
 * `u = x + n`: `Γ(x) = (1/u)·R(u)` with `R(u) = Γ(1+u) / ∏_{j=1}^{n}(u − j)` and
 * `Γ(1+u) = exp(lnΓShift)`. `R(0) = (−1)^n/n! ≠ 0`, so `R` is analytic.
 */
function gammaRegularPartExpr(
  ce: ComputeEngine,
  u: Expression,
  n: number,
  deg: number
): Expression {
  const gammaShift = ce.function('Exp', [lnGammaShiftExpr(ce, u, deg)]);
  if (n === 0) return gammaShift;
  const factors: Expression[] = [];
  for (let j = 1; j <= n; j++)
    factors.push(ce.function('Subtract', [u, ce.number(j)]));
  const denom = factors.length === 1 ? factors[0] : ce.function('Multiply', factors);
  return ce.function('Divide', [gammaShift, denom]);
}

/**
 * Leading Laurent data of a recognized special function `op` about its pole at
 * `point`, returned as a `Laurent` in the local variable `t = x − point`, or
 * `null` when `point` is not a pole of `op`. Coefficients are exact/symbolic
 * (using `EulerGamma`, `Pi`, `Zeta(k)`).
 */
function specialLaurent(
  ce: ComputeEngine,
  op: string,
  point: Expression,
  W: number
): Laurent | null {
  if (point.im !== 0) return null;
  if (!isRecordedPole(ce, op, point)) return null;
  const u = ce.symbol('_seriesU');

  if (op === 'Zeta') {
    // ζ(s) = 1/(s−1) + γ + Σ_{k≥1} (−1)^k/k!·γ_k·(s−1)^k. Only the residue and
    // the constant (Stieltjes γ_0 = γ) are elementary; higher γ_k are not in
    // the engine, so `hi = 0` (residue + constant only).
    if (point.re !== 1) return null;
    return { v: -1, c: [ce.One, ce.symbol('EulerGamma')], hi: 0 };
  }

  const re = point.re;
  if (!Number.isInteger(re) || re > 0) return null;
  const n = -re;

  if (op === 'Gamma') {
    // Γ(x) = (1/u)·R(u); expand R to degree W+1 → Laurent powers −1..W.
    const R = gammaRegularPartExpr(ce, u, n, W + 1);
    const taylor = expandViaSeeds(R, '_seriesU', ce.Zero, ce, W + 1);
    if (!taylor) return null;
    return { v: -1, c: taylor.map((c) => c.evaluate()), hi: W };
  }

  if (op === 'Digamma') {
    // ψ(x) = d/dx ln Γ(x) = −1/u + R'(u)/R(u), R the Gamma regular part.
    const R = gammaRegularPartExpr(ce, u, n, W + 1);
    const dR = differentiate(R, '_seriesU');
    if (dR === undefined) return null;
    const reg = expandViaSeeds(
      ce.function('Divide', [dR, R]),
      '_seriesU',
      ce.Zero,
      ce,
      W
    );
    if (!reg) return null;
    return {
      v: -1,
      c: [ce.NegativeOne, ...reg.map((c) => c.evaluate())],
      hi: W,
    };
  }

  return null;
}

/** Compose a Laurent outer series (in `u`) with an inner composition variable
 * `w` of valuation ≥ 1 (so `u = w`). Handles the common case `w = t` (identity)
 * directly; otherwise substitutes term by term (negative powers via reciprocal). */
function composeSpecial(
  ce: ComputeEngine,
  outer: Laurent,
  w: Laurent,
  W: number
): Laurent | null {
  // Fast path: `w` is exactly the monomial `t` (arg is the plain shifted
  // variable) — the outer series already IS the answer in `t`.
  const wv = trueVal(w);
  if (
    wv === 1 &&
    coeffAt(ce, w, 1).isSame(1) &&
    w.c.every((c, i) => i === 1 - w.v || c.isSame(0))
  )
    return outer;

  if (wv === null || wv < 1) return null; // composition variable must vanish
  let result = lConst(ce, ce.Zero, W);
  for (let p = outer.v; p <= outer.hi; p++) {
    const cp = coeffAt(ce, outer, p);
    if (cp.isSame(0)) continue;
    let wp: Laurent | null;
    if (p >= 0) wp = powLaurent(ce, w, p, W);
    else wp = reciprocalLaurent(ce, powLaurent(ce, w, -p, W), W);
    if (!wp) return null;
    result = addLaurent(ce, result, scaleLaurent(ce, cp, wp), W);
  }
  return { ...result, hi: Math.min(result.hi, outer.hi) };
}

// ─────────────────────────────────────────────────────────────────────────
//  Laurent structural expansion
// ─────────────────────────────────────────────────────────────────────────

/** Rewrites of pole-carrying trig/hyperbolic functions into a quotient the
 * Laurent divide path can expand (e.g. `cot a → cos a / sin a`). */
const POLE_QUOTIENT: Record<
  string,
  (ce: ComputeEngine, a: Expression) => Expression
> = {
  Tan: (ce, a) =>
    ce.function('Divide', [ce.function('Sin', [a]), ce.function('Cos', [a])]),
  Cot: (ce, a) =>
    ce.function('Divide', [ce.function('Cos', [a]), ce.function('Sin', [a])]),
  Sec: (ce, a) => ce.function('Divide', [ce.One, ce.function('Cos', [a])]),
  Csc: (ce, a) => ce.function('Divide', [ce.One, ce.function('Sin', [a])]),
  Tanh: (ce, a) =>
    ce.function('Divide', [ce.function('Sinh', [a]), ce.function('Cosh', [a])]),
  Coth: (ce, a) =>
    ce.function('Divide', [ce.function('Cosh', [a]), ce.function('Sinh', [a])]),
  Sech: (ce, a) => ce.function('Divide', [ce.One, ce.function('Cosh', [a])]),
  Csch: (ce, a) => ce.function('Divide', [ce.One, ce.function('Sinh', [a])]),
};

/** `1/subExpr` as a Laurent value. Detects the denominator's valuation `m`; for
 * a pole (`m > 0`) it re-expands the denominator to order `W + 2m` so the unit
 * reciprocal has enough terms to be exact to power `W`. */
function reciprocalOfExpr(
  sub: Expression,
  x: string,
  x0: Expression,
  ce: ComputeEngine,
  W: number
): Laurent | null {
  const probe = expandLaurent(sub, x, x0, ce, W);
  if (!probe) return null;
  const m = trueVal(probe);
  if (m === null) return null; // sub ≡ 0
  if (m <= 0) return reciprocalLaurent(ce, probe, W);
  const Wb = Math.min(W + 2 * m, MAX_SERIES_ORDER);
  const boosted = Wb === W ? probe : expandLaurent(sub, x, x0, ce, Wb);
  if (!boosted) return null;
  return reciprocalLaurent(ce, boosted, W);
}

function powerSeriesLaurent(
  expr: Expression,
  x: string,
  x0: Expression,
  ce: ComputeEngine,
  W: number
): Laurent | null {
  if (!isFunction(expr)) return null;
  const [base, expo] = expr.ops;
  const baseHasX = base.has(x);
  const expHasX = expo.has(x);
  if (!baseHasX && !expHasX) return lConst(ce, expr, W);

  if (baseHasX && !expHasX) {
    const k = asSmallInteger(expo);
    if (k !== null && k >= 0) {
      const bs = expandLaurent(base, x, x0, ce, W);
      return bs ? powLaurent(ce, bs, k, W) : null;
    }
    if (k !== null && k < 0)
      return reciprocalOfExpr(
        ce.function('Power', [base, ce.number(-k)]),
        x,
        x0,
        ce,
        W
      );
    // Non-integer constant exponent: binomial series around base0 ≠ 0. A
    // vanishing base is a branch point — defer.
    const bs = expandLaurent(base, x, x0, ce, W);
    if (!bs || bs.v < 0) return null;
    const base0 = coeffAt(ce, bs, 0);
    if (base0.isSame(0)) return null;
    const outer = powerOuter(ce, expo, base0, W);
    if (!outer) return null;
    return lFromTaylor(
      composeOuter(ce, outer, laurentToTaylor(ce, bs, W), W),
      bs.hi
    );
  }

  // Exponent depends on x: base^{expo} = exp(expo·ln base). A pole in the
  // exponent is an essential singularity (e.g. e^{1/x}) — defer.
  const g0 = base.isSame(ce.E)
    ? expo
    : ce.function('Multiply', [expo, ce.function('Ln', [base])]);
  const inner = expandLaurent(g0, x, x0, ce, W);
  if (!inner || inner.v < 0) return null;
  const outer = unaryTaylor(ce, 'Exp', coeffAt(ce, inner, 0), W);
  if (!outer) return null;
  return lFromTaylor(
    composeOuter(ce, outer, laurentToTaylor(ce, inner, W), W),
    inner.hi
  );
}

/**
 * Laurent expansion of `expr` in `x` about `x0` to upper power `W`. Returns
 * `null` (defer) on an essential singularity, a branch point, or an operator
 * the engine cannot expand. This is the singular-case counterpart of
 * `expandViaSeeds`: it is tried only after the Taylor engines give up.
 */
function expandLaurent(
  expr: Expression,
  x: string,
  x0: Expression,
  ce: ComputeEngine,
  W: number
): Laurent | null {
  checkDeadline(ce._deadline);
  if (W < 0) return null;

  if (isNumber(expr)) return lConst(ce, expr, W);

  if (isSymbol(expr)) {
    if (expr.symbol === x) {
      const c = zeroCoeffs(ce, W);
      c[0] = x0;
      if (W >= 1) c[1] = ce.One;
      return { v: 0, c, hi: W };
    }
    return lConst(ce, expr, W);
  }

  if (!isFunction(expr)) return null;
  if (!expr.has(x)) return lConst(ce, expr, W);

  const op = expr.operator;
  const ops = expr.ops;

  switch (op) {
    case 'Add': {
      let acc = lConst(ce, ce.Zero, W);
      for (const t of ops) {
        const s = expandLaurent(t, x, x0, ce, W);
        if (!s) return null;
        acc = addLaurent(ce, acc, s, W);
      }
      return acc;
    }
    case 'Negate': {
      const s = expandLaurent(ops[0], x, x0, ce, W);
      return s ? scaleLaurent(ce, ce.NegativeOne, s) : null;
    }
    case 'Subtract': {
      const a = expandLaurent(ops[0], x, x0, ce, W);
      const b = expandLaurent(ops[1], x, x0, ce, W);
      if (!a || !b) return null;
      return addLaurent(ce, a, scaleLaurent(ce, ce.NegativeOne, b), W);
    }
    case 'Multiply': {
      let acc = lConst(ce, ce.One, W);
      for (const t of ops) {
        const s = expandLaurent(t, x, x0, ce, W);
        if (!s) return null;
        acc = mulLaurent(ce, acc, s, W);
      }
      return acc;
    }
    case 'Divide': {
      const rec = reciprocalOfExpr(ops[1], x, x0, ce, W);
      if (!rec) return null;
      const Wa = Math.min(W + Math.max(0, -rec.v), MAX_SERIES_ORDER);
      const aL = expandLaurent(ops[0], x, x0, ce, Wa);
      if (!aL) return null;
      return mulLaurent(ce, aL, rec, W);
    }
    case 'Power':
      return powerSeriesLaurent(expr, x, x0, ce, W);
    case 'Root': {
      const m = asSmallInteger(ops[1]);
      if (m === null || m === 0) return null;
      const bs = expandLaurent(ops[0], x, x0, ce, W);
      if (!bs || bs.v < 0) return null;
      const base0 = coeffAt(ce, bs, 0);
      if (base0.isSame(0)) return null; // branch point
      const outer = powerOuter(ce, ce.number(1).div(ce.number(m)), base0, W);
      if (!outer) return null;
      return lFromTaylor(
        composeOuter(ce, outer, laurentToTaylor(ce, bs, W), W),
        bs.hi
      );
    }
    default: {
      if (ops.length !== 1) return null;
      const inner = expandLaurent(ops[0], x, x0, ce, W);
      if (!inner) return null;
      const b0 = coeffAt(ce, inner, 0);

      // Special-function pole: expand `Op` about the pole `b0` and compose.
      if (SPECIAL_POLE_FNS.has(op)) {
        const special = specialLaurent(ce, op, b0, W);
        if (special) {
          const w = addLaurent(ce, inner, lConst(ce, b0.neg(), W), W);
          const composed = composeSpecial(ce, special, w, W);
          if (composed) return composed;
        }
      }

      // Regular composition needs a pole-free argument.
      if (inner.v >= 0) {
        const outer = unaryTaylor(ce, op, b0, W);
        if (outer)
          return lFromTaylor(
            composeOuter(ce, outer, laurentToTaylor(ce, inner, W), W),
            inner.hi
          );
      }

      // Pole-carrying trig/hyperbolic: rewrite to a quotient and retry.
      const rewrite = POLE_QUOTIENT[op];
      if (rewrite) return expandLaurent(rewrite(ce, ops[0]), x, x0, ce, W);

      return null;
    }
  }
}

/**
 * Build the result expression from a Laurent value. `power(p)` produces the
 * `p`-th basis expression. The retained terms run from the valuation up to
 * `min(n, hi)`; the `BigO` remainder is placed at the first unretained nonzero
 * (reliable) power, or at `hi + 1` when every reliable power beyond the cut is
 * zero.
 */
function assembleLaurent(
  ce: ComputeEngine,
  L: Laurent,
  n: number,
  power: (p: number) => Expression
): Expression {
  const top = Math.min(n, L.hi);
  const terms: Expression[] = [];
  for (let p = L.v; p <= top; p++) {
    const c = coeffAt(ce, L, p);
    if (c.isSame(0)) continue;
    if (p === 0) {
      terms.push(c);
    } else {
      const pw = power(p);
      terms.push(c.isSame(1) ? pw : ce.function('Multiply', [c, pw]));
    }
  }

  let m = L.hi + 1;
  for (let p = top + 1; p <= L.hi; p++) {
    if (!coeffAt(ce, L, p).isSame(0)) {
      m = p;
      break;
    }
  }
  terms.push(ce.function('BigO', [power(m)]));

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

  const xExpr = ce.symbol(x);
  const t = x0.isSame(0)
    ? xExpr
    : ce.function('Subtract', [xExpr, x0]);
  const power = (k: number): Expression =>
    k === 1 ? t : ce.function('Power', [t, ce.number(k)]);

  // Regular point: the Taylor engines. A `null` here means a singularity was
  // hit (or the operator is not differentiable) — retry with the Laurent engine
  // before giving up.
  //
  // Exception: a special function at a recorded pole (e.g. `Digamma(x)` at 0)
  // is expanded by the Laurent engine *first*, because its value there
  // (`Digamma(0)`) stays symbolic-yet-finite rather than reporting as infinite,
  // so the Taylor engines would otherwise return a spurious regular expansion.
  if (!specialPoleInvolved(f, x, x0, ce)) {
    const coeffs = taylorCoeffs(f, x, x0, ce, W);
    if (coeffs) {
      const exact = isPolynomialInVar(f, x) && allZeroBeyond(coeffs, n, W);
      return assemble(ce, coeffs, n, W, power, exact);
    }
  }

  const laurent = expandLaurent(f, x, x0, ce, W);
  if (!laurent) return undefined;
  return assembleLaurent(ce, laurent, n, power);
}

/** True when `f` applies a pole-carrying special function to an argument that
 * lands on one of its recorded poles at `x0` — the signal to prefer the Laurent
 * engine (see `computeSeries`). */
function specialPoleInvolved(
  f: Expression,
  x: string,
  x0: Expression,
  ce: ComputeEngine
): boolean {
  for (const op of SPECIAL_POLE_FNS) {
    for (const sub of f.getSubexpressions(op)) {
      if (!isFunction(sub)) continue;
      const arg = sub.ops[0];
      if (!arg) continue;
      const at = arg.subs({ [x]: x0 }).evaluate();
      if (isRecordedPole(ce, op, at)) return true;
    }
  }
  return false;
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

  const xExpr = ce.symbol(x);
  // Map s^p back to x^{−p} (a negative s-power — a pole at ∞ — becomes a
  // positive power of x, i.e. the polynomial part of the asymptotic expansion).
  const power = (p: number): Expression =>
    p === 0 ? ce.One : ce.function('Power', [xExpr, ce.number(-p)]);

  const coeffs = expandByDerivative(g, s, ce.Zero, ce, W, resolve);
  if (coeffs) {
    const exact = isPolynomialInVar(g, s) && allZeroBeyond(coeffs, n, W);
    return assemble(ce, coeffs, n, W, power, exact);
  }

  // A pole at ∞ (e.g. x²/(x−1)): `g` has a pole at s = 0 that the
  // differentiation path cannot carry — expand it as a Laurent series in s.
  const laurent = expandLaurent(g, s, ce.Zero, ce, W);
  if (!laurent) return undefined;
  return assembleLaurent(ce, laurent, n, power);
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
