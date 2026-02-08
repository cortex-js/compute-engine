import { NumericValue } from '../numeric-value/types';
import type { BoxedExpression } from '../global-types';
import { AbstractTensor } from '../tensor/tensors';
import { getInequalityBoundsFromAssumptions } from './inequality-bounds';
import {
  isBoxedNumber,
  isBoxedFunction,
  isBoxedSymbol,
  isBoxedString,
  isBoxedTensor,
} from './type-guards';
// Dynamic import for expand to avoid circular dependency
// (expand → arithmetic-add → boxed-tensor → abstract-boxed-expression → compare)

/**
 * Structural equality of boxed expressions.
 */
export function same(a: BoxedExpression, b: BoxedExpression): boolean {
  if (a === b) return true;

  //
  // BoxedFunction
  // Operator and operands must match
  //
  if (isBoxedFunction(a)) {
    if (a.operator !== b.operator) return false;
    if (!isBoxedFunction(b)) return false;
    if (a.nops !== b.nops) return false;
    return a.ops.every((op, i) => same(op, b.ops[i]));
  }

  //
  // BoxedNumber
  //
  if (isBoxedNumber(a)) {
    if (!isBoxedNumber(b)) return false;
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
  if (isBoxedString(a) || isBoxedString(b)) {
    if (!isBoxedString(a) || !isBoxedString(b)) return false;
    return a.string === b.string;
  }

  //
  // BoxedSymbol
  //
  if (isBoxedSymbol(a) || isBoxedSymbol(b)) {
    if (!isBoxedSymbol(a) || !isBoxedSymbol(b)) return false;
    return a.symbol === b.symbol;
  }

  //
  // BoxedTensor
  //
  if (isBoxedTensor(a)) {
    if (a.rank !== 0) {
      if (!isBoxedTensor(b)) return false;
      if (a.rank !== b.rank) return false;
      for (let i = 0; i < a.rank; i++)
        if (a.shape[i] !== b.shape[i]) return false;
      return (a.tensor as AbstractTensor<any>).equals(
        b.tensor as AbstractTensor<any>
      );
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
  a: BoxedExpression,
  inputB: number | BoxedExpression
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
  if (isBoxedFunction(a) || isBoxedFunction(b)) {
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

    // If the expression have some unknowns, we only try to prove equality
    // if they have the same unknowns and are structurally equal after
    // expansing and simplification
    const { expand } = require('./expand');
    a = (expand(a) ?? a).simplify();
    b = (expand(b) ?? b).simplify();
    if (!sameUnknowns(a, b)) return undefined;
    return same(a, b);
  }

  //
  // A symbol may have special comparison handlers
  //
  if (isBoxedSymbol(a)) {
    const cmp = a.valueDefinition?.eq?.(b);
    if (cmp !== undefined) return cmp;
  }
  if (isBoxedSymbol(b)) {
    const cmp = b.valueDefinition?.eq?.(a);
    if (cmp !== undefined) return cmp;
  }
  if (isBoxedSymbol(a) && isBoxedSymbol(b)) return a.symbol === b.symbol;

  const ce = a.engine;

  //
  // For number literals, we compare the approximate values, that is
  // we want 0.9 and 9/10 to be considered equal
  //
  if (isBoxedNumber(a) && isBoxedNumber(b)) {
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
  a: BoxedExpression,
  b: number | BoxedExpression
): '<' | '=' | '>' | '>=' | '<=' | undefined {
  if (isBoxedNumber(a)) {
    //
    // Special case when b is a plain machine number
    //
    if (
      typeof b !== 'number' &&
      isBoxedNumber(b) &&
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

    if (!isBoxedNumber(b)) {
      // Check if b is a symbol with inequality assumptions
      if (isBoxedSymbol(b)) {
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
            const lowerNum = isBoxedNumber(lb)
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
            const upperNum = isBoxedNumber(ub)
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
    if (isBoxedSymbol(a)) {
      const bounds = getInequalityBoundsFromAssumptions(a.engine, a.symbol);

      // We're comparing a (symbol) to b (number)
      // If a has a lower bound >= b, then a > b (or a >= b)
      if (bounds.lowerBound !== undefined) {
        const lb = bounds.lowerBound;
        const lowerNum = isBoxedNumber(lb)
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
        const upperNum = isBoxedNumber(ub)
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
    }
    return undefined;
  }

  //
  // Do we have at least one function expression?
  //
  // Note: we could have `1-x` and `x` (a symbol), so they don't have
  // to both be function expressions.
  //
  if (isBoxedFunction(a) || isBoxedFunction(b)) {
    // If the function has a special handler for equality, use it
    const cmp = a.operatorDefinition?.eq?.(a, b);
    if (cmp !== undefined) return '=';

    // Subtract the two expressions
    const diff = a.sub(b).N();

    // If the difference is not a number, we can't compare
    // For example, '1 + y' and 'x - 1' can't be compared
    if (!isBoxedNumber(diff)) return undefined;

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
  if (isBoxedSymbol(a)) {
    // A symbol without a value is equal to itself
    if (isBoxedSymbol(b) && a.symbol === b.symbol) return '=';

    // Symbols may have special comparision handlers
    const cmpResult = a.valueDefinition?.cmp?.(b);
    if (cmpResult) return cmpResult;
    const eqResult = a.valueDefinition?.eq?.(b);
    if (eqResult === true) return '=';

    // Check inequality assumptions for the symbol
    if (isBoxedNumber(b)) {
      const bounds = getInequalityBoundsFromAssumptions(a.engine, a.symbol);
      const bNum =
        typeof b.numericValue === 'number' ? b.numericValue : b.numericValue.re;

      if (bNum !== undefined && Number.isFinite(bNum)) {
        // If symbol has a lower bound >= b, then symbol > b (or symbol >= b)
        if (bounds.lowerBound !== undefined) {
          const lb = bounds.lowerBound;
          const lowerNum = isBoxedNumber(lb)
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
          const upperNum = isBoxedNumber(ub)
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

    return undefined;
  }

  //
  // A string
  //
  if (isBoxedString(a)) {
    if (!isBoxedString(b)) return undefined;
    if (a.string === b.string) return '=';
    return a.string < b.string ? '<' : '>';
  }

  //
  // For tensors, only equality applies
  //
  if (isBoxedTensor(a)) {
    if (!isBoxedTensor(b)) return undefined;
    if (
      (a.tensor as AbstractTensor<any>).equals(b.tensor as AbstractTensor<any>)
    )
      return '=';
    return undefined;
  }

  return undefined;
}

function isZeroWithTolerance(expr: BoxedExpression): boolean {
  if (!isBoxedNumber(expr)) return false;
  const n = expr.numericValue;
  const ce = expr.engine;
  if (typeof n === 'number') return ce.chop(n) === 0;
  return n.isZeroWithTolerance(ce.tolerance);
}

function sameUnknowns(a: BoxedExpression, b: BoxedExpression): boolean {
  const ua = a.unknowns;
  const ub = b.unknowns;
  if (ua.length !== ub.length) return false;
  for (const u of ua) if (!ub.includes(u)) return false;
  return true;
}
