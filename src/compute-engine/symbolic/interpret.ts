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
 * See `docs/plans/2026-07-09-ellipsis-interpretation-design.md` for the v1 gate
 * and the generalization ladder (v2+).
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

/** Exact real integer/rational literal (v1 admits these samples only). */
function isExactRationalLiteral(x: Expression): boolean {
  return (
    isNumber(x) && x.isExact && x.isReal === true && x.isRational === true
  );
}

/**
 * Attempt to interpret a single expression node as a continuation-bearing
 * `Add`/`Multiply`, returning the `Sum`/`Product` interpretation, or `null`
 * when the strict v1 gate does not pass.
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
 * Given a validated candidate, apply the v1 gate (arithmetic progression + a
 * well-formed upper bound) and build the `Sum`/`Product`, or return `null`.
 */
function buildInterpretation(
  expr: Expression,
  op: 'Add' | 'Multiply',
  { samples, anchor, leftover }: Continuation
): Expression | null {
  const ce = expr.engine;
  const m = samples.length;
  const s1 = samples[0];

  // Common difference d = s₂ − s₁ (exact), and confirm the samples form an
  // arithmetic progression with that step.
  const d = ce.function('Subtract', [samples[1], s1]).evaluate();
  if (d.isSame(0)) return null;
  for (let i = 1; i < m; i++) {
    const di = ce.function('Subtract', [samples[i], samples[i - 1]]).evaluate();
    if (!di.isSame(d)) return null;
  }

  // Upper bound U = (A − s₁) / d + 1, computed symbolically.
  const U = ce
    .function('Add', [
      ce.function('Divide', [ce.function('Subtract', [anchor, s1]), d]),
      ce.One,
    ])
    .simplify();
  if (!isValidUpperBound(U, m)) return null;

  // Fresh index symbol not used anywhere in the expression.
  const used = collectSymbols(expr);
  let indexName: string | undefined;
  for (const candidate of ['k', 'j', 'i']) {
    if (!used.has(candidate)) {
      indexName = candidate;
      break;
    }
  }
  indexName ??= freshSymbolName('k', used);
  const index = ce.symbol(indexName);

  // General term t(k) = s₁ + (k − 1)·d.
  const term = ce
    .function('Add', [
      s1,
      ce.function('Multiply', [ce.function('Subtract', [index, ce.One]), d]),
    ])
    .simplify();

  const bigOp = op === 'Add' ? 'Sum' : 'Product';
  const interpretation = ce.function(bigOp, [
    term,
    ce.function('Tuple', [index, ce.One, U]),
  ]);

  if (leftover.length === 0) return interpretation;
  return ce.function(op, [...leftover, interpretation]);
}

/**
 * The upper bound is valid when it is either:
 *  - a positive integer literal ≥ m + 1 (the anchor lies beyond the samples), or
 *  - affine in exactly one free symbol with integer coefficients (e.g. `n`,
 *    `n + 1`, `2n − 3`). This rejects `1 + 3 + \dots + 2n`, whose even anchor
 *    does not belong to the odd progression (U = n + 1/2).
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
 * `null` when nothing in the tree matched the v1 gate.
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
