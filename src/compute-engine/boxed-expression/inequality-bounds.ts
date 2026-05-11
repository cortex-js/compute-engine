import type {
  Expression,
  IComputeEngine as ComputeEngine,
  IntervalBounds,
} from '../global-types';
import { isFunction, isSymbol, isNumber } from './type-guards';

/**
 * Extract interval bounds for `symbol` from a condition expression.
 *
 * Unlike `getInequalityBoundsFromAssumptions` (which reads the engine's
 * assumption DB), this function operates directly on an AST shape:
 *
 * - bare comparisons (`Less`, `LessEqual`, `Greater`, `GreaterEqual`),
 *   including chained forms like `Less(a, x, b)`
 * - `And(c1, c2, ...)` of supported shapes
 * - `When(e, cond)` — unwraps to `cond`
 * - `Multiply(f, When(...), ...)` — the Desmos parse shape for
 *   `f(x)\{a < x < b\}`; bounds from each `When` factor are merged
 *
 * Returns `undefined` if `expr` doesn't carry interval information for
 * `symbol`, or if the information is not a simple lower-upper pair.
 */
export function extractIntervalBounds(
  expr: Expression,
  symbol: string
): IntervalBounds | undefined {
  // Unwrap When(e, cond) → operate on cond.
  if (isFunction(expr, 'When')) {
    const cond = expr.op2;
    if (!cond) return undefined;
    return extractIntervalBounds(cond, symbol);
  }

  // Handle Multiply(f, When(e, cond), ...) — the restriction is embedded as
  // a When factor. Desmos-style `f(x)\{0 < x < 5\}` parses to this shape.
  // If multiple When factors are present, merge their bounds.
  if (isFunction(expr, 'Multiply')) {
    const ops = expr.ops;
    if (!ops) return undefined;
    const merged: IntervalBounds = {};
    for (const sub of ops) {
      if (isFunction(sub, 'When')) {
        const sub_ = extractIntervalBounds(sub, symbol);
        if (sub_ !== undefined) _mergeBounds(merged, sub_);
      }
    }
    return _hasAnyBound(merged) ? merged : undefined;
  }

  const result: IntervalBounds = {};

  // Recursively merge bounds from And(c1, c2, ...).
  if (isFunction(expr, 'And')) {
    const ops = expr.ops;
    if (!ops) return undefined;
    for (const sub of ops) {
      const subBounds = extractIntervalBounds(sub, symbol);
      if (subBounds === undefined) continue;
      _mergeBounds(result, subBounds);
    }
    return _hasAnyBound(result) ? result : undefined;
  }

  // Comparison heads: Less, LessEqual, Greater, GreaterEqual.
  const op = expr.operator;
  if (
    (op === 'Less' ||
      op === 'LessEqual' ||
      op === 'Greater' ||
      op === 'GreaterEqual') &&
    isFunction(expr)
  ) {
    const isStrict = op === 'Less' || op === 'Greater';
    const ops = expr.ops;
    if (!ops || ops.length < 2) return undefined;

    // Normalize Greater/GreaterEqual to Less/LessEqual form by flipping.
    // Less(a, b, c)   means  a < b < c
    // Greater(a, b)   means  a > b  → treated as b < a  (flipped to [b, a])
    const flipped =
      op === 'Greater' || op === 'GreaterEqual'
        ? [...ops].reverse()
        : ops;

    // Walk the (flipped) chain looking for `symbol` as an operand.
    // For chain [lower, symbol]: lower bound.
    // For chain [symbol, upper]: upper bound.
    // For chain [lower, symbol, upper]: both bounds.
    for (let i = 0; i < flipped.length; i++) {
      if (isSymbol(flipped[i], symbol)) {
        if (i > 0) {
          // The operand before is a lower bound.
          const candidate = flipped[i - 1];
          if (
            result.lower === undefined ||
            candidate.isGreater(result.lower) === true
          ) {
            result.lower = candidate;
            result.lowerStrict = isStrict;
          }
        }
        if (i < flipped.length - 1) {
          // The operand after is an upper bound.
          const candidate = flipped[i + 1];
          if (
            result.upper === undefined ||
            candidate.isLess(result.upper) === true
          ) {
            result.upper = candidate;
            result.upperStrict = isStrict;
          }
        }
      }
    }
    return _hasAnyBound(result) ? result : undefined;
  }

  return undefined;
}

function _mergeBounds(into: IntervalBounds, from: IntervalBounds): void {
  if (from.lower !== undefined) {
    if (
      into.lower === undefined ||
      from.lower.isGreater(into.lower) === true
    ) {
      into.lower = from.lower;
      into.lowerStrict = from.lowerStrict;
    } else if (from.lower.isSame(into.lower)) {
      // Same numeric bound: strict wins (more restrictive)
      into.lowerStrict = into.lowerStrict || from.lowerStrict;
    }
  }
  if (from.upper !== undefined) {
    if (
      into.upper === undefined ||
      from.upper.isLess(into.upper) === true
    ) {
      into.upper = from.upper;
      into.upperStrict = from.upperStrict;
    } else if (from.upper.isSame(into.upper)) {
      into.upperStrict = into.upperStrict || from.upperStrict;
    }
  }
}

function _hasAnyBound(b: IntervalBounds): boolean {
  return b.lower !== undefined || b.upper !== undefined;
}

/**
 * Get inequality bounds for a symbol from the assumption database.
 *
 * For example, if `x > 4` is assumed, this returns `{ lower: 4, lowerStrict: true }`.
 * If `x <= 10` is assumed, this returns `{ upper: 10, upperStrict: false }`.
 *
 * Note: Assumptions are normalized to forms like:
 * - `x > 4` becomes `Less(Add(Negate(x), 4), 0)` i.e., `4 - x < 0`
 * - `x > 0` becomes `Less(Negate(x), 0)` i.e., `-x < 0`
 *
 * @param ce - The compute engine instance
 * @param symbol - The symbol name to query
 * @returns The `IntervalBounds` (same shape used by `extractIntervalBounds`).
 */
export function getInequalityBoundsFromAssumptions(
  ce: ComputeEngine,
  symbol: string
): IntervalBounds {
  const result: IntervalBounds = {};

  const assumptions = ce.context?.assumptions;
  if (!assumptions) return result;

  for (const [assumption, _] of assumptions.entries()) {
    const op = assumption.operator;
    if (!op) continue;

    // Assumptions are normalized to Less or LessEqual with RHS = 0
    if (op !== 'Less' && op !== 'LessEqual') continue;

    if (!isFunction(assumption)) continue;
    const ops = assumption.ops;
    if (ops.length !== 2) continue;

    const [lhs, rhs] = ops;

    // RHS should be 0 for normalized assumptions
    if (!rhs.isSame(0)) continue;

    const isStrict = op === 'Less';

    // Case 1: Negate(symbol) < 0 => -symbol < 0 => symbol > 0
    // This gives us a lower bound of 0
    if (isFunction(lhs, 'Negate') && isSymbol(lhs.op1, symbol)) {
      const bound = ce.Zero;
      if (
        result.lower === undefined ||
        bound.isGreater(result.lower) === true
      ) {
        result.lower = bound;
        result.lowerStrict = isStrict;
      }
    }

    // Case 2: Add(Negate(symbol), k) < 0 => k - symbol < 0 => symbol > k
    // This gives us a lower bound of k
    if (isFunction(lhs, 'Add')) {
      let hasNegatedSymbol = false;
      let constantSum = 0;

      for (const term of lhs.ops) {
        if (isFunction(term, 'Negate') && isSymbol(term.op1, symbol)) {
          hasNegatedSymbol = true;
        } else if (isNumber(term)) {
          const val =
            typeof term.numericValue === 'number'
              ? term.numericValue
              : term.numericValue?.re;
          if (val !== undefined && Number.isFinite(val)) {
            constantSum += val;
          }
        }
      }

      if (hasNegatedSymbol && constantSum !== 0) {
        // k - symbol < 0 => symbol > k
        const bound = ce.expr(constantSum);
        if (
          result.lower === undefined ||
          bound.isGreater(result.lower) === true
        ) {
          result.lower = bound;
          result.lowerStrict = isStrict;
        }
      }
    }

    // Case 3: symbol < 0 => symbol has upper bound 0
    if (isSymbol(lhs, symbol)) {
      const bound = ce.Zero;
      if (
        result.upper === undefined ||
        bound.isLess(result.upper) === true
      ) {
        result.upper = bound;
        result.upperStrict = isStrict;
      }
    }

    // Case 4: Add(symbol, k) < 0 => symbol + k < 0 => symbol < -k
    // This gives us an upper bound of -k
    if (isFunction(lhs, 'Add')) {
      let hasSymbol = false;
      let constantSum = 0;

      for (const term of lhs.ops) {
        if (isSymbol(term, symbol)) {
          hasSymbol = true;
        } else if (isNumber(term)) {
          const val =
            typeof term.numericValue === 'number'
              ? term.numericValue
              : term.numericValue?.re;
          if (val !== undefined && Number.isFinite(val)) {
            constantSum += val;
          }
        }
      }

      if (hasSymbol && constantSum !== 0) {
        // symbol + k < 0 => symbol < -k
        const bound = ce.expr(-constantSum);
        if (
          result.upper === undefined ||
          bound.isLess(result.upper) === true
        ) {
          result.upper = bound;
          result.upperStrict = isStrict;
        }
      }
    }
  }

  return result;
}
