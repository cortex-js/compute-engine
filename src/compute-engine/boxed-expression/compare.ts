import { NumericValue } from '../numeric-value/types';
import type { Expression } from '../global-types';
import { getInequalityBoundsFromAssumptions } from './inequality-bounds';
import {
  isNumber,
  isFunction,
  isSymbol,
  isString,
  isTensor,
} from './type-guards';
import { stochasticEqual } from './stochastic-equal';

// Lazy reference to break circular dependency:
// expand → arithmetic-add → boxed-tensor → abstract-boxed-expression → compare
type ExpandFn = (expr: Expression) => Expression;
let _expand: ExpandFn;
/** @internal */
export function _setExpand(fn: ExpandFn) {
  _expand = fn;
}

/**
 * Structural equality of boxed expressions.
 */
export function same(a: Expression, b: Expression): boolean {
  if (a === b) return true;

  //
  // BoxedFunction
  // Operator and operands must match
  //
  if (isFunction(a)) {
    if (a.operator !== b.operator) return false;
    if (!isFunction(b)) return false;
    if (a.nops !== b.nops) return false;
    return a.ops.every((op, i) => same(op, b.ops[i]));
  }

  //
  // BoxedNumber
  //
  if (isNumber(a)) {
    if (!isNumber(b)) return false;
    const av = a.numericValue;
    const bv = b.numericValue;
    if (av === bv) return true;
    if (typeof av === 'number') {
      if (typeof bv === 'number') return av === bv;
      return bv.eq(av);
    }
    return av.eq(bv);
  }

  //
  // BoxedString
  //
  if (isString(a) || isString(b)) {
    if (!isString(a) || !isString(b)) return false;
    return a.string === b.string;
  }

  //
  // BoxedSymbol
  //
  if (isSymbol(a) || isSymbol(b)) {
    if (!isSymbol(a) || !isSymbol(b)) return false;
    return a.symbol === b.symbol;
  }

  //
  // BoxedTensor
  //
  if (isTensor(a)) {
    if (a.rank !== 0) {
      if (!isTensor(b)) return false;
      if (a.rank !== b.rank) return false;
      for (let i = 0; i < a.rank; i++)
        if (a.shape[i] !== b.shape[i]) return false;
      return a.tensor.equals(b.tensor);
    }
  }

  return false;
}

/**
 * Mathematical equality of two boxed expressions.
 *
 * In general, it is impossible to always prove equality
 * ([Richardson's theorem](https://en.wikipedia.org/wiki/Richardson%27s_theorem)) but this works often...
 */
export function eq(
  a: Expression,
  inputB: number | Expression
): boolean | undefined {
  // We want to give a chance to the eq handler of the functions first
  if (a.operatorDefinition?.eq) {
    const cmp = a.operatorDefinition.eq(a, a.engine.box(inputB));
    if (cmp !== undefined) return cmp;
  }
  if (typeof inputB !== 'number' && inputB.operatorDefinition?.eq) {
    const cmp = inputB.operatorDefinition.eq(inputB, a);
    if (cmp !== undefined) return cmp;
  }

  //
  // We want to compare the **value** of the boxed expressions.
  //
  a = a.N();
  let b = typeof inputB !== 'number' ? inputB.N() : a.engine.box(inputB);

  //
  // Do we have at least one function expression?
  //
  // Note: we could have `1-x` and `x` (a symbol), so they don't have
  // to both be function expressions.
  //
  if (isFunction(a) || isFunction(b)) {
    // If the function has a special handler for equality, use it
    let cmp = a.operatorDefinition?.eq?.(a, b);
    if (cmp !== undefined) return cmp;
    cmp = b.operatorDefinition?.eq?.(b, a);
    if (cmp !== undefined) return cmp;

    // If the expressions are structurally identical, they are equal
    if (a.isSame(b)) return true;

    // If the difference is zero (within tolerance), the expressions are equal
    if (a.unknowns.length === 0 && b.unknowns.length === 0) {
      if (a.isFinite && b.isFinite)
        return isZeroWithTolerance(a.sub(b).simplify().N());
      if (a.isNaN || b.isNaN) return false;
      if (a.isInfinity && b.isInfinity && a.sgn === b.sgn) return true;
      return false;
    }

    // Try structural equality after expand+simplify first
    a = _expand(a).simplify();
    b = _expand(b).simplify();
    if (same(a, b)) return true;

    // Fall back to stochastic evaluation at random sample points
    return stochasticEqual(a, b);
  }

  //
  // A symbol may have special comparison handlers
  //
  if (isSymbol(a)) {
    const cmp = a.valueDefinition?.eq?.(b);
    if (cmp !== undefined) return cmp;
  }
  if (isSymbol(b)) {
    const cmp = b.valueDefinition?.eq?.(a);
    if (cmp !== undefined) return cmp;
  }
  if (isSymbol(a) && isSymbol(b)) return a.symbol === b.symbol;

  const ce = a.engine;

  //
  // For number literals, we compare the approximate values, that is
  // we want 0.9 and 9/10 to be considered equal
  //
  if (isNumber(a) && isNumber(b)) {
    if (a.isFinite && b.isFinite) return isZeroWithTolerance(a.sub(b));
    if (a.isNaN || b.isNaN) return false;
    if (a.isInfinity && b.isInfinity && a.sgn === b.sgn) return true;
    return false;
  }

  //
  // If we didn't come to a resolution yet, check the assumptions DB
  //
  if (ce.ask(ce.box(['Equal', a, b])).length > 0) return true;
  if (ce.ask(ce.box(['NotEqual', a, b])).length > 0) return false;

  // If a or b have some unknowns, we can't prove equality
  if (a.unknowns.length > 0 || b.unknowns.length > 0) return undefined;

  //
  // For strings and tensors, mathematical equality is same as structural
  // equality of their values
  //
  return same(a, b);
}

export function cmp(
  a: Expression,
  b: number | Expression
): '<' | '=' | '>' | '>=' | '<=' | undefined {
  if (isNumber(a)) {
    //
    // Special case when b is a plain machine number
    //
    if (
      typeof b !== 'number' &&
      isNumber(b) &&
      typeof b.numericValue === 'number'
    )
      b = b.numericValue;
    if (typeof b === 'number') {
      if (b === 0) {
        // We could be querying the sign of a number
        const s = a.sgn;
        if (s === undefined) return undefined;
        if (s === 'zero') return '=';
        if (s === 'positive') return '>';
        if (s === 'negative') return '<';
        if (s === 'non-negative') return '>=';
        if (s === 'non-positive') return '<=';
        return undefined;
      }

      // To be mathematically equal to b, a must be a number
      const av = a.numericValue;
      if (typeof av === 'number') {
        if (Math.abs(av - b) <= a.engine.tolerance) return '=';
        return av < b ? '<' : '>';
      }
      if (av.eq(b)) return '=';
      return av.lt(b) ? '<' : '>';
    }

    if (!isNumber(b)) {
      // Check if b is a symbol with inequality assumptions
      if (isSymbol(b)) {
        const bounds = getInequalityBoundsFromAssumptions(a.engine, b.symbol);
        const aNum =
          typeof a.numericValue === 'number'
            ? a.numericValue
            : a.numericValue.re;

        if (aNum !== undefined && Number.isFinite(aNum)) {
          // We're comparing a (number) to b (symbol)
          // If b has a lower bound > a, then a < b
          if (bounds.lowerBound !== undefined) {
            const lb = bounds.lowerBound;
            const lowerNum = isNumber(lb)
              ? typeof lb.numericValue === 'number'
                ? lb.numericValue
                : lb.numericValue.re
              : undefined;

            if (lowerNum !== undefined && Number.isFinite(lowerNum)) {
              // b > lowerBound (if strict) or b >= lowerBound (if not strict)
              // If lowerBound > a, then b > a, so a < b
              if (lowerNum > aNum) return '<';
              // If lowerBound = a and strict (b > a), then a < b
              if (lowerNum === aNum && bounds.lowerStrict) return '<';
              // If lowerBound = a and not strict (b >= a), then a <= b
              if (lowerNum === aNum && !bounds.lowerStrict) return '<=';
            }
          }

          // If b has an upper bound < a, then a > b
          if (bounds.upperBound !== undefined) {
            const ub = bounds.upperBound;
            const upperNum = isNumber(ub)
              ? typeof ub.numericValue === 'number'
                ? ub.numericValue
                : ub.numericValue.re
              : undefined;

            if (upperNum !== undefined && Number.isFinite(upperNum)) {
              // b < upperBound (if strict) or b <= upperBound (if not strict)
              // If upperBound < a, then b < a, so a > b
              if (upperNum < aNum) return '>';
              // If upperBound = a and strict (b < a), then a > b
              if (upperNum === aNum && bounds.upperStrict) return '>';
              // If upperBound = a and not strict (b <= a), then a >= b
              if (upperNum === aNum && !bounds.upperStrict) return '>=';
            }
          }

          // Fall back to the symbol's known numeric value
          const bSymNum = b.re;
          if (typeof bSymNum === 'number' && Number.isFinite(bSymNum)) {
            const tol = a.engine.tolerance;
            if (Math.abs(aNum - bSymNum) <= tol) return '=';
            return aNum < bSymNum ? '<' : '>';
          }
        }
      }
      return undefined;
    }

    const av = a.numericValue;
    const bv = b.numericValue as NumericValue;
    if (typeof av === 'number') {
      if (bv.eq(av)) return '=';
      if (bv.lt(av)) return '>';
      return '<';
    }
    return av.eq(bv) ? '=' : av.lt(bv) ? '<' : '>';
  }

  if (typeof b === 'number') {
    // Check if a is a symbol with inequality assumptions
    if (isSymbol(a)) {
      const bounds = getInequalityBoundsFromAssumptions(a.engine, a.symbol);

      // We're comparing a (symbol) to b (number)
      // If a has a lower bound >= b, then a > b (or a >= b)
      if (bounds.lowerBound !== undefined) {
        const lb = bounds.lowerBound;
        const lowerNum = isNumber(lb)
          ? typeof lb.numericValue === 'number'
            ? lb.numericValue
            : lb.numericValue.re
          : undefined;

        if (lowerNum !== undefined && Number.isFinite(lowerNum)) {
          // a > lowerBound (if strict) or a >= lowerBound (if not strict)
          // If lowerBound > b, then a > b
          if (lowerNum > b) return '>';
          // If lowerBound = b and strict (a > b), then a > b
          if (lowerNum === b && bounds.lowerStrict) return '>';
          // If lowerBound = b and not strict (a >= b), then a >= b
          if (lowerNum === b && !bounds.lowerStrict) return '>=';
        }
      }

      // If a has an upper bound <= b, then a < b (or a <= b)
      if (bounds.upperBound !== undefined) {
        const ub = bounds.upperBound;
        const upperNum = isNumber(ub)
          ? typeof ub.numericValue === 'number'
            ? ub.numericValue
            : ub.numericValue.re
          : undefined;

        if (upperNum !== undefined && Number.isFinite(upperNum)) {
          // a < upperBound (if strict) or a <= upperBound (if not strict)
          // If upperBound < b, then a < b
          if (upperNum < b) return '<';
          // If upperBound = b and strict (a < b), then a < b
          if (upperNum === b && bounds.upperStrict) return '<';
          // If upperBound = b and not strict (a <= b), then a <= b
          if (upperNum === b && !bounds.upperStrict) return '<=';
        }
      }

      // Fall back to the symbol's known numeric value (e.g. Pi, ExponentialE)
      const aNum = a.re;
      if (typeof aNum === 'number' && Number.isFinite(aNum)) {
        const tol = a.engine.tolerance;
        if (Math.abs(aNum - b) <= tol) return '=';
        return aNum < b ? '<' : '>';
      }
    }

    // Handle function expressions (e.g., Negate(Pi)) compared to a number
    if (isFunction(a)) {
      if (b === 0) {
        const s = a.sgn;
        if (s === 'zero') return '=';
        if (s === 'positive') return '>';
        if (s === 'negative') return '<';
        if (s === 'non-negative') return '>=';
        if (s === 'non-positive') return '<=';
      }
      const aNum = a.re;
      if (typeof aNum === 'number' && Number.isFinite(aNum)) {
        const tol = a.engine.tolerance;
        if (Math.abs(aNum - b) <= tol) return '=';
        return aNum < b ? '<' : '>';
      }
    }
    return undefined;
  }

  //
  // Do we have at least one function expression?
  //
  // Note: we could have `1-x` and `x` (a symbol), so they don't have
  // to both be function expressions.
  //
  if (isFunction(a) || isFunction(b)) {
    // If the function has a special handler for equality, use it
    const cmp = a.operatorDefinition?.eq?.(a, b);
    if (cmp !== undefined) return '=';

    // Subtract the two expressions
    const diff = a.sub(b).N();

    // If the difference is not a number, we can't compare
    // For example, '1 + y' and 'x - 1' can't be compared
    if (!isNumber(diff)) return undefined;

    if (typeof diff.numericValue === 'number') {
      if (diff.numericValue === 0) return '=';
      return diff.numericValue < 0 ? '<' : '>';
    }

    // We'll use the the tolerance of the engine
    const tol = a.engine.tolerance;
    if (diff.numericValue.isZeroWithTolerance(tol)) return '=';
    return diff.numericValue.lt(0) ? '<' : '>';
  }

  //
  // A symbol
  //
  if (isSymbol(a)) {
    // A symbol without a value is equal to itself
    if (isSymbol(b) && a.symbol === b.symbol) return '=';

    // Symbols may have special comparision handlers
    const cmpResult = a.valueDefinition?.cmp?.(b);
    if (cmpResult) return cmpResult;
    const eqResult = a.valueDefinition?.eq?.(b);
    if (eqResult === true) return '=';

    // Check inequality assumptions for the symbol
    if (isNumber(b)) {
      const bounds = getInequalityBoundsFromAssumptions(a.engine, a.symbol);
      const bNum =
        typeof b.numericValue === 'number' ? b.numericValue : b.numericValue.re;

      if (bNum !== undefined && Number.isFinite(bNum)) {
        // If symbol has a lower bound >= b, then symbol > b (or symbol >= b)
        if (bounds.lowerBound !== undefined) {
          const lb = bounds.lowerBound;
          const lowerNum = isNumber(lb)
            ? typeof lb.numericValue === 'number'
              ? lb.numericValue
              : lb.numericValue.re
            : undefined;

          if (lowerNum !== undefined && Number.isFinite(lowerNum)) {
            // symbol > lowerBound (if strict) or symbol >= lowerBound (if not strict)
            // If lowerBound > b, then symbol > b
            if (lowerNum > bNum) return '>';
            // If lowerBound = b and strict (symbol > b), then symbol > b
            if (lowerNum === bNum && bounds.lowerStrict) return '>';
            // If lowerBound = b and not strict (symbol >= b), then symbol >= b
            if (lowerNum === bNum && !bounds.lowerStrict) return '>=';
          }
        }

        // If symbol has an upper bound <= b, then symbol < b (or symbol <= b)
        if (bounds.upperBound !== undefined) {
          const ub = bounds.upperBound;
          const upperNum = isNumber(ub)
            ? typeof ub.numericValue === 'number'
              ? ub.numericValue
              : ub.numericValue.re
            : undefined;

          if (upperNum !== undefined && Number.isFinite(upperNum)) {
            // symbol < upperBound (if strict) or symbol <= upperBound (if not strict)
            // If upperBound < b, then symbol < b
            if (upperNum < bNum) return '<';
            // If upperBound = b and strict (symbol < b), then symbol < b
            if (upperNum === bNum && bounds.upperStrict) return '<';
            // If upperBound = b and not strict (symbol <= b), then symbol <= b
            if (upperNum === bNum && !bounds.upperStrict) return '<=';
          }
        }
      }
    }

    // Fall back to the symbol's known numeric value (e.g. Pi, ExponentialE)
    const aNum = a.re;
    if (typeof aNum === 'number' && Number.isFinite(aNum)) {
      const bNum = typeof b === 'number' ? b : b.re;
      if (typeof bNum === 'number' && Number.isFinite(bNum)) {
        const tol = a.engine.tolerance;
        if (Math.abs(aNum - bNum) <= tol) return '=';
        return aNum < bNum ? '<' : '>';
      }
    }

    return undefined;
  }

  //
  // A string
  //
  if (isString(a)) {
    if (!isString(b)) return undefined;
    if (a.string === b.string) return '=';
    return a.string < b.string ? '<' : '>';
  }

  //
  // For tensors, only equality applies
  //
  if (isTensor(a)) {
    if (!isTensor(b)) return undefined;
    if (a.tensor.equals(b.tensor)) return '=';
    return undefined;
  }

  return undefined;
}

function isZeroWithTolerance(expr: Expression): boolean {
  if (!isNumber(expr)) return false;
  const n = expr.numericValue;
  const ce = expr.engine;
  if (typeof n === 'number') return ce.chop(n) === 0;
  return n.isZeroWithTolerance(ce.tolerance);
}
