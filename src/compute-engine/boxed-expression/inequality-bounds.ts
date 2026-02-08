import type {
  BoxedExpression,
  IComputeEngine as ComputeEngine,
} from '../global-types';

/**
 * Get inequality bounds for a symbol from the assumption database.
 *
 * For example, if `x > 4` is assumed, this returns `{ lowerBound: 4, lowerStrict: true }`.
 * If `x <= 10` is assumed, this returns `{ upperBound: 10, upperStrict: false }`.
 *
 * Note: Assumptions are normalized to forms like:
 * - `x > 4` becomes `Less(Add(Negate(x), 4), 0)` i.e., `4 - x < 0`
 * - `x > 0` becomes `Less(Negate(x), 0)` i.e., `-x < 0`
 *
 * @param ce - The compute engine instance
 * @param symbol - The symbol name to query
 * @returns An object with lowerBound, upperBound, and strictness flags
 */
export function getInequalityBoundsFromAssumptions(
  ce: ComputeEngine,
  symbol: string
): {
  lowerBound?: BoxedExpression;
  lowerStrict?: boolean;
  upperBound?: BoxedExpression;
  upperStrict?: boolean;
} {
  const result: {
    lowerBound?: BoxedExpression;
    lowerStrict?: boolean;
    upperBound?: BoxedExpression;
    upperStrict?: boolean;
  } = {};

  const assumptions = ce.context?.assumptions;
  if (!assumptions) return result;

  for (const [assumption, _] of assumptions.entries()) {
    const op = assumption.operator;
    if (!op) continue;

    // Assumptions are normalized to Less or LessEqual with RHS = 0
    if (op !== 'Less' && op !== 'LessEqual') continue;

    const ops = assumption.ops;
    if (!ops || ops.length !== 2) continue;

    const [lhs, rhs] = ops;

    // RHS should be 0 for normalized assumptions
    if (!rhs.is(0)) continue;

    const isStrict = op === 'Less';

    // Case 1: Negate(symbol) < 0 => -symbol < 0 => symbol > 0
    // This gives us a lower bound of 0
    if (lhs.operator === 'Negate' && lhs.op1?.symbol === symbol) {
      const bound = ce.Zero;
      if (
        result.lowerBound === undefined ||
        bound.isGreater(result.lowerBound) === true
      ) {
        result.lowerBound = bound;
        result.lowerStrict = isStrict;
      }
    }

    // Case 2: Add(Negate(symbol), k) < 0 => k - symbol < 0 => symbol > k
    // This gives us a lower bound of k
    if (lhs.operator === 'Add' && lhs.ops) {
      let hasNegatedSymbol = false;
      let constantSum = 0;

      for (const term of lhs.ops) {
        if (term.operator === 'Negate' && term.op1?.symbol === symbol) {
          hasNegatedSymbol = true;
        } else if (term.isNumberLiteral) {
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
        const bound = ce.box(constantSum);
        if (
          result.lowerBound === undefined ||
          bound.isGreater(result.lowerBound) === true
        ) {
          result.lowerBound = bound;
          result.lowerStrict = isStrict;
        }
      }
    }

    // Case 3: symbol < 0 => symbol has upper bound 0
    if (lhs.symbol === symbol) {
      const bound = ce.Zero;
      if (
        result.upperBound === undefined ||
        bound.isLess(result.upperBound) === true
      ) {
        result.upperBound = bound;
        result.upperStrict = isStrict;
      }
    }

    // Case 4: Add(symbol, k) < 0 => symbol + k < 0 => symbol < -k
    // This gives us an upper bound of -k
    if (lhs.operator === 'Add' && lhs.ops) {
      let hasSymbol = false;
      let constantSum = 0;

      for (const term of lhs.ops) {
        if (term.symbol === symbol) {
          hasSymbol = true;
        } else if (term.isNumberLiteral) {
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
        const bound = ce.box(-constantSum);
        if (
          result.upperBound === undefined ||
          bound.isLess(result.upperBound) === true
        ) {
          result.upperBound = bound;
          result.upperStrict = isStrict;
        }
      }
    }
  }

  return result;
}
