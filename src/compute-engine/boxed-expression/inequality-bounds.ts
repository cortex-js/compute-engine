import type {
  Expression,
  IComputeEngine as ComputeEngine,
  IntervalBounds,
} from '../global-types.js';
import { isFunction, isSymbol } from './type-guards.js';
import {
  type Subject,
  toSubject,
  subjectKey,
  getFactIndex,
} from './constraint-subject.js';

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
      op === 'Greater' || op === 'GreaterEqual' ? [...ops].reverse() : ops;

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
    if (into.lower === undefined || from.lower.isGreater(into.lower) === true) {
      into.lower = from.lower;
      into.lowerStrict = from.lowerStrict;
    } else if (from.lower.isSame(into.lower)) {
      // Same numeric bound: strict wins (more restrictive)
      into.lowerStrict = into.lowerStrict || from.lowerStrict;
    }
  }
  if (from.upper !== undefined) {
    if (into.upper === undefined || from.upper.isLess(into.upper) === true) {
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
 * Get inequality bounds for a subject from the assumption database.
 *
 * For example, if `x > 4` is assumed, this returns `{ lower: 4, lowerStrict: true }`.
 * If `x <= 10` is assumed, this returns `{ upper: 10, upperStrict: false }`.
 *
 * The subject may be a bare symbol (pass the symbol name, or a `Subject`
 * with `part: 'self'`) or a part-extractor of a symbol, e.g.
 * `{ symbol: 's', part: 're' }` for facts about `Real(s)`
 * (see `constraint-subject.ts`).
 *
 * Note: Assumptions are normalized to forms like:
 * - `x > 4` becomes `Less(Add(Negate(x), 4), 0)` i.e., `4 - x < 0`
 * - `x > 0` becomes `Less(Negate(x), 0)` i.e., `-x < 0`
 * - `Re(s) > 1` becomes `Less(Add(Negate(Real(s)), 1), 0)`
 *
 * The result is derived from the cached fact index (see `getFactIndex`),
 * so repeated queries against unchanged assumptions cost a lookup.
 *
 * @param ce - The compute engine instance
 * @param subject - The symbol name or `Subject` to query
 * @returns The `IntervalBounds` (same shape used by `extractIntervalBounds`).
 */
export function getInequalityBoundsFromAssumptions(
  ce: ComputeEngine,
  subject: string | Subject
): IntervalBounds {
  const facts = getFactIndex(ce).bySubject.get(subjectKey(toSubject(subject)));
  // Return a copy: the index is shared and must not be mutated by callers.
  return facts ? { ...facts.bounds } : {};
}
