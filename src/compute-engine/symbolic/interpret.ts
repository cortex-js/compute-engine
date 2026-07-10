import type { Expression } from '../global-types.js';
import { isFunction, isNumber, isSymbol } from '../boxed-expression/type-guards.js';
import { collectSymbols, freshSymbolName } from './solver-utils.js';

/**
 * Ellipsis interpretation — from *notation* to *meaning*.
 *
 * The ellipsis fold barrier (CHANGELOG 2026-07-09) makes an `Add`/`Multiply`
 * carrying a `ContinuationPlaceholder` an inert notational object:
 * `1 + 2 + \dots + n` parses to `["Add", 1, 2, "ContinuationPlaceholder", "n"]`
 * with source order and nested anchors preserved. This module is the (strictly
 * gated) inference that turns such an object into a `Sum`/`Product`.
 *
 * The recognizer is a shared core; the `Interpret` head is a thin wrapper (see
 * `library/arithmetic.ts`). Future recognizers (e.g. sequence closed-form
 * recognition) live alongside `inferContinuationPattern` here.
 *
 * See `docs/plans/2026-07-09-ellipsis-interpretation-design.md` for the gate
 * and the generalization ladder. Recognizers are tried in order: arithmetic
 * progression (v1) → polynomial via finite differences → geometric (v2).
 */

/**
 * A candidate continuation extracted from the operands of a canonical
 * `Add`/`Multiply`: a contiguous run of exact numeric samples immediately
 * preceding the placeholder, a single anchor after it, and any leftover
 * (non-sample) terms that precede the run.
 */
interface Continuation {
  /** The exact numeric sample terms, in source order (length ≥ 2). */
  samples: Expression[];
  /** The single anchor term after the `ContinuationPlaceholder`. */
  anchor: Expression;
  /** Terms before the sample run — kept as-is alongside the interpretation. */
  leftover: Expression[];
}

/** Exact real integer/rational literal (samples are admitted only as these). */
function isExactRationalLiteral(x: Expression): boolean {
  return (
    isNumber(x) && x.isExact && x.isReal === true && x.isRational === true
  );
}

/**
 * Attempt to interpret a single expression node as a continuation-bearing
 * `Add`/`Multiply`, returning the `Sum`/`Product` interpretation, or `null`
 * when no recognizer's gate passes.
 */
function interpretNode(expr: Expression): Expression | null {
  if (!isFunction(expr)) return null;
  const op = expr.operator;
  if (op !== 'Add' && op !== 'Multiply') return null;

  const ops = expr.ops;

  // Exactly one ContinuationPlaceholder among the operands.
  const placeholderIndices = ops
    .map((x, i) => (isSymbol(x, 'ContinuationPlaceholder') ? i : -1))
    .filter((i) => i >= 0);
  if (placeholderIndices.length !== 1) return null;
  const p = placeholderIndices[0];

  // Exactly one anchor after the placeholder (it must be the last operand).
  if (p !== ops.length - 2) return null;
  const anchor = ops[ops.length - 1];
  if (isSymbol(anchor, 'ContinuationPlaceholder')) return null;

  // Samples: the contiguous run of exact numeric literals ending just before
  // the placeholder. Everything before that run is leftover.
  let start = p;
  while (start > 0 && isExactRationalLiteral(ops[start - 1])) start--;
  const samples = ops.slice(start, p);
  const leftover = ops.slice(0, start);
  if (samples.length < 2) return null;

  const continuation: Continuation = { samples, anchor, leftover };
  return buildInterpretation(expr, op, continuation);
}

/**
 * Given a validated candidate, run the recognizers in order — arithmetic
 * progression (v1), polynomial (finite differences), geometric — returning the
 * first `Sum`/`Product` that passes its gate, or `null`.
 */
function buildInterpretation(
  expr: Expression,
  op: 'Add' | 'Multiply',
  continuation: Continuation
): Expression | null {
  return (
    tryArithmeticProgression(expr, op, continuation) ??
    tryPolynomial(expr, op, continuation) ??
    tryGeometric(expr, op, continuation)
  );
}

/** A fresh index symbol not used anywhere in `expr` (prefers `k`, `j`, `i`). */
function freshIndex(expr: Expression): Expression {
  const used = collectSymbols(expr);
  let indexName: string | undefined;
  for (const candidate of ['k', 'j', 'i']) {
    if (!used.has(candidate)) {
      indexName = candidate;
      break;
    }
  }
  indexName ??= freshSymbolName('k', used);
  return expr.engine.symbol(indexName);
}

/** Assemble the `Sum`/`Product`, re-attaching any leftover leading terms. */
function assemble(
  expr: Expression,
  op: 'Add' | 'Multiply',
  leftover: Expression[],
  term: Expression,
  index: Expression,
  U: Expression
): Expression {
  const ce = expr.engine;
  const bigOp = op === 'Add' ? 'Sum' : 'Product';
  const interpretation = ce.function(bigOp, [
    term,
    ce.function('Tuple', [index, ce.One, U]),
  ]);
  if (leftover.length === 0) return interpretation;
  return ce.function(op, [...leftover, interpretation]);
}

// ---------------------------------------------------------------------------
// v1 — arithmetic progression (shapes must stay byte-identical).
// ---------------------------------------------------------------------------

/**
 * Arithmetic progression: constant exact difference `d ≠ 0`, general term
 * `t(k) = s₁ + (k − 1)·d`, upper bound `U = (A − s₁)/d + 1` computed
 * symbolically and gated by {@link isValidUpperBound}.
 */
function tryArithmeticProgression(
  expr: Expression,
  op: 'Add' | 'Multiply',
  { samples, anchor, leftover }: Continuation
): Expression | null {
  const ce = expr.engine;
  const m = samples.length;
  const s1 = samples[0];

  const d = ce.function('Subtract', [samples[1], s1]).evaluate();
  if (d.isSame(0)) return null;
  for (let i = 1; i < m; i++) {
    const di = ce.function('Subtract', [samples[i], samples[i - 1]]).evaluate();
    if (!di.isSame(d)) return null;
  }

  const U = ce
    .function('Add', [
      ce.function('Divide', [ce.function('Subtract', [anchor, s1]), d]),
      ce.One,
    ])
    .simplify();
  if (!isValidUpperBound(U, m)) return null;

  const index = freshIndex(expr);
  const term = ce
    .function('Add', [
      s1,
      ce.function('Multiply', [ce.function('Subtract', [index, ce.One]), d]),
    ])
    .simplify();

  return assemble(expr, op, leftover, term, index, U);
}

// ---------------------------------------------------------------------------
// v2 — polynomial via finite differences.
// ---------------------------------------------------------------------------

function factorial(n: number): number {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

/**
 * Polynomial recognizer (degree `g ≥ 2`). Successive finite differences of the
 * samples until a constant row give the degree `g`; the general term is
 * Newton's forward-difference formula `t(k) = Σⱼ Δʲs₁·C(k−1, j)`. Degree 1 is
 * left to {@link tryArithmeticProgression}. The anchor must validate to a
 * well-formed upper bound (this is also the m = g+1 structural confirmation).
 */
function tryPolynomial(
  expr: Expression,
  op: 'Add' | 'Multiply',
  { samples, anchor, leftover }: Continuation
): Expression | null {
  const ce = expr.engine;
  const m = samples.length;

  // Successive finite-difference rows: rows[i] has length m − i.
  const rows: Expression[][] = [samples];
  while (rows[rows.length - 1].length > 1) {
    const cur = rows[rows.length - 1];
    const next: Expression[] = [];
    for (let i = 1; i < cur.length; i++)
      next.push(ce.function('Subtract', [cur[i], cur[i - 1]]).evaluate());
    rows.push(next);
  }

  // Degree = smallest g ≥ 1 whose difference row is constant. A length-1 row
  // (g = m − 1) is trivially constant: that is the m = g+1 case, where the term
  // is the unique interpolant and the anchor must carry the evidence.
  const isConstant = (row: Expression[]): boolean =>
    row.every((x) => x.isSame(row[0]));
  let degree = -1;
  for (let g = 1; g < rows.length; g++) {
    if (isConstant(rows[g])) {
      degree = g;
      break;
    }
  }
  if (degree < 2) return null;

  const coefficients: Expression[] = [];
  for (let j = 0; j <= degree; j++) coefficients.push(rows[j][0]);

  const index = freshIndex(expr);
  const term = newtonTerm(ce, coefficients, index);

  const U = validateAnchor(ce, term, index, anchor, m, samples, null);
  if (!U) return null;

  return assemble(expr, op, leftover, term, index, U);
}

/**
 * Newton's forward-difference general term for the exact sample differences
 * `coefficients[j] = Δʲs₁`: `t(k) = Σⱼ coefficients[j]·C(k−1, j)`, with
 * `C(k−1, j) = (k−1)(k−2)…(k−j)/j!`. Built with canonical operations and
 * simplified (never `.add()`/`.mul()`, which would fold exact literals).
 */
function newtonTerm(
  ce: Expression['engine'],
  coefficients: Expression[],
  index: Expression
): Expression {
  const g = coefficients.length - 1;
  const terms: Expression[] = [];
  for (let j = 0; j <= g; j++) {
    const cj = coefficients[j];
    if (j === 0) {
      terms.push(cj);
      continue;
    }
    const factors: Expression[] = [];
    for (let i = 0; i < j; i++)
      factors.push(ce.function('Subtract', [index, ce.number(i + 1)]));
    const numerator =
      factors.length === 1 ? factors[0] : ce.function('Multiply', factors);
    const binomial = ce.function('Divide', [
      numerator,
      ce.number(factorial(j)),
    ]);
    terms.push(ce.function('Multiply', [cj, binomial]));
  }
  return ce.function('Add', terms).simplify();
}

// ---------------------------------------------------------------------------
// v2 — geometric.
// ---------------------------------------------------------------------------

/**
 * Geometric recognizer: constant exact ratio `r` (`r ≠ 0, |r| ≠ 1`) between
 * consecutive samples, general term `t(k) = s₁·r^(k−1)`. The anchor must
 * validate to a well-formed upper bound (also the m = 2 structural
 * confirmation).
 */
function tryGeometric(
  expr: Expression,
  op: 'Add' | 'Multiply',
  { samples, anchor, leftover }: Continuation
): Expression | null {
  const ce = expr.engine;
  const m = samples.length;
  const s1 = samples[0];
  if (s1.isSame(0)) return null;

  const r = ce.function('Divide', [samples[1], s1]).evaluate();
  if (r.isSame(0) || r.isSame(1) || r.isSame(-1)) return null;
  for (let i = 1; i < m; i++) {
    const ri = ce.function('Divide', [samples[i], samples[i - 1]]).evaluate();
    if (!ri.isSame(r)) return null;
  }

  const index = freshIndex(expr);
  const term = ce
    .function('Multiply', [
      s1,
      ce.function('Power', [r, ce.function('Subtract', [index, ce.One])]),
    ])
    .simplify();

  const U = validateAnchor(ce, term, index, anchor, m, samples, { s1, r });
  if (!U) return null;

  return assemble(expr, op, leftover, term, index, U);
}

// ---------------------------------------------------------------------------
// Anchor validation (polynomial + geometric families).
// ---------------------------------------------------------------------------

/**
 * Find an upper bound `U` such that `t(U) = A`, gated so the resulting `Sum` is
 * well-formed. `geo` is `null` for polynomials (candidate `U = s` by
 * substitution) or `{ s1, r }` for geometric (candidate `U = log_r(A/s₁) + 1`).
 *
 *  - *numeric anchor* `A`: bounded exact integer search for `U ≥ m + 1` with
 *    `t(U) = A` (the sequence is eventually monotonic, so the search stops on
 *    overshoot); accepts only exact integer bounds.
 *  - *symbolic anchor* `A` (one free symbol): the family candidate `U`, accepted
 *    iff `t(U) ≡ A` exactly and `U` passes the v1 shape gate.
 */
function validateAnchor(
  ce: Expression['engine'],
  term: Expression,
  index: Expression,
  anchor: Expression,
  m: number,
  samples: Expression[],
  geo: { s1: Expression; r: Expression } | null
): Expression | null {
  const free = anchor.freeVariables;

  if (free.length === 0)
    return findNumericUpperBound(ce, term, index, anchor, m, samples);

  if (free.length !== 1) return null;

  let U: Expression;
  if (geo) {
    // U = log_r(A / s₁) + 1. Simplify the logarithm on its own first: the
    // exact reduction log_b(b^k) = k does not fire when the Log is buried in an
    // unsimplified Add, which would leave a non-affine bound.
    const logPart = ce
      .function('Log', [ce.function('Divide', [anchor, geo.s1]), geo.r])
      .simplify();
    U = ce.function('Add', [logPart, ce.One]).simplify();
  } else {
    U = ce.symbol(free[0]);
  }

  if (verifyTerm(ce, term, index, U, anchor) && isValidUpperBound(U, m))
    return U;
  return null;
}

/** `t(U) ≡ A` — the difference evaluates exactly to zero. */
function verifyTerm(
  ce: Expression['engine'],
  term: Expression,
  index: Expression,
  U: Expression,
  anchor: Expression
): boolean {
  const name = isSymbol(index) ? index.symbol : '';
  const value = ce
    .function('Subtract', [term.subs({ [name]: U }), anchor])
    .evaluate();
  return value.isSame(0);
}

/**
 * Bounded exact integer search for `U ≥ m + 1` with `t(U) = A`. The recognized
 * families are eventually monotonic, so the search stops once the numeric value
 * of `t` overshoots `A` (a hard cap guards against pathological terms).
 */
function findNumericUpperBound(
  ce: Expression['engine'],
  term: Expression,
  index: Expression,
  anchor: Expression,
  m: number,
  samples: Expression[]
): Expression | null {
  const CAP = 100000;
  const anchorValue = anchor.N().re;
  const increasing =
    samples[samples.length - 1].N().re >= samples[0].N().re;
  const name = isSymbol(index) ? index.symbol : '';

  for (let u = m + 1; u <= CAP; u++) {
    const value = term.subs({ [name]: u }).evaluate();
    if (value.isSame(anchor)) return ce.number(u);
    const numeric = value.N().re;
    if (!Number.isFinite(numeric)) break;
    if (increasing && numeric > anchorValue) break;
    if (!increasing && numeric < anchorValue) break;
  }
  return null;
}

/**
 * The upper bound is valid when it is either:
 *  - a positive integer literal ≥ m + 1 (the anchor lies beyond the samples), or
 *  - affine in exactly one free symbol with integer coefficients (e.g. `n`,
 *    `n + 1`, `2n − 3`). This rejects `1 + 3 + \dots + 2n`, whose even anchor
 *    does not belong to the odd progression (U = n + 1/2), and non-affine bounds
 *    such as `log₂(m) + 1` from a spurious geometric match.
 */
function isValidUpperBound(U: Expression, m: number): boolean {
  const free = U.freeVariables;

  if (free.length === 0)
    return isNumber(U) && U.isInteger === true && U.re >= m + 1;

  if (free.length !== 1) return false;

  const ce = U.engine;
  const s = free[0];

  // Extract the affine coefficients: c₀ = U|ₛ₌₀, c₁ = (U|ₛ₌₁) − c₀.
  const c0 = U.subs({ [s]: 0 }).simplify();
  const c1 = ce.function('Subtract', [U.subs({ [s]: 1 }), c0]).simplify();
  if (!(isNumber(c0) && c0.isInteger === true)) return false;
  if (!(isNumber(c1) && c1.isInteger === true) || c1.isSame(0)) return false;

  // Confirm U is exactly affine (degree ≤ 1): U − (c₁·s + c₀) ≡ 0.
  const residual = ce
    .function('Subtract', [
      U,
      ce.function('Add', [ce.function('Multiply', [c1, ce.symbol(s)]), c0]),
    ])
    .simplify();
  return residual.isSame(0);
}

/**
 * Interpret every continuation-bearing `Add`/`Multiply` in `expr`, descending
 * into subexpressions so that `x + (1 + 2 + \dots + n)` and
 * `Equal(lhs, ellipsisExpr)` get their inner continuation interpreted. Each
 * candidate is gated independently.
 *
 * Returns the rewritten expression when at least one continuation fired, or
 * `null` when nothing in the tree matched a gate.
 */
export function inferContinuationPattern(expr: Expression): Expression | null {
  // A node that itself is a continuation-bearing Add/Multiply: interpret it
  // directly (its samples are literals, so there is nothing deeper to descend
  // into).
  const direct = interpretNode(expr);
  if (direct) return direct;

  // Otherwise descend into the operands, rebuilding if any child fired.
  if (!isFunction(expr)) return null;
  const ops = expr.ops;
  let changed = false;
  const newOps = ops.map((child) => {
    const r = inferContinuationPattern(child);
    if (r) {
      changed = true;
      return r;
    }
    return child;
  });
  if (!changed) return null;
  return expr.engine.function(expr.operator, newOps);
}
