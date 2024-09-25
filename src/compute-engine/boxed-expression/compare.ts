import { NumericValue } from '../numeric-value/public';
import { BoxedExpression } from './public';

/**
 * Structural equality of boxed expressions.
 */
export function same(a: BoxedExpression, b: BoxedExpression): boolean {
  if (a === b) return true;

  //
  // BoxedFunction
  // Operator and operands must match
  //
  if (a.ops) {
    if (a.operator !== b.operator) return false;
    if (a.nops !== b.nops) return false;
    return a.ops.every((op, i) => same(op, b.ops![i]));
  }

  //
  // BoxedNumber
  //
  if (a.isNumberLiteral) {
    if (!b.isNumberLiteral) return false;
    const av = a.numericValue!;
    const bv = b.numericValue!;
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
  if (a.string || b.string) return a.string === b.string;

  //
  // BoxedSymbol
  //
  if (a.symbol || b.symbol) return a.symbol === b.symbol;

  //
  // BoxedTensor
  //
  if (a.rank !== 0) {
    if (a.rank !== b.rank) return false;
    for (let i = 0; i < a.rank; i++)
      if (a.shape[i] !== b.shape[i]) return false;
    return a.tensor!.equals(b.tensor!);
  }

  return false;
}

/**
 * Mathematically equality of two boxed expressions.
 *
 * In general, it is impossible to always prove equality
 * ([Richardson's theorem](https://en.wikipedia.org/wiki/Richardson%27s_theorem)) but this works often...
 */
export function eq(
  a: BoxedExpression,
  b: number | BoxedExpression
): boolean | undefined {
  //
  // We want to compare the **value** of the boxed expressions.
  //
  a = a.N();
  if (typeof b !== 'number') b = b.N();

  //
  // Special case when b is a plain machine number
  //
  if (typeof b !== 'number' && typeof b.numericValue === 'number')
    b = b.numericValue;
  if (typeof b === 'number') {
    // If a can never be equal to b, return false
    if (a.string || a.tensor || !a.isValid) return false;

    // If we're a symbol or function expression, we don't
    // yet know if we're equal, but we could be later. Return undefined.
    if (!a.isNumberLiteral) return undefined;

    // To be mathematically equal, a must be a number
    const av = a.numericValue!;
    if (typeof av === 'number') return av === b;
    return av.eq(b);
  }

  //
  // Do we have at least one function expression?
  //
  // Note: we could have `1-x` and `x` (a symbol), so they don't have
  // to both be function expressions.
  //
  if (a.ops || b.ops) {
    // If the function has a special handler for equality, use it
    const cmp = a.functionDefinition?.eq?.(a, b);
    if (cmp !== undefined) return cmp;

    // Subtract the two expressions
    const diff = a.sub(b).N();

    // If the difference is zero, the expressions are equal
    if (!diff.isNumberLiteral) return false;

    if (typeof diff.numericValue === 'number') return diff.numericValue === 0;

    // We'll use the the tolerance of the engine
    const tol = a.engine.tolerance;
    return diff.numericValue!.isZeroWithTolerance(tol);
  }

  //
  // A symbol may have special comparision handlers
  //
  if (a.symbol) {
    const cmp = a.symbolDefinition?.eq?.(b);
    if (cmp !== undefined) return cmp;
    return a.symbol === b.symbol;
  }

  //
  // If we didn't come to a resolution yet, check the assumptions DB
  //
  const ce = a.engine;
  if (ce.ask(ce.box(['Equal', a, b])).length > 0) return true;
  if (ce.ask(ce.box(['NotEqual', a, b])).length > 0) return false;

  //
  // For numbers, strings and tensors, mathematical equality is
  // same as structural equality of their values (in the case
  // of number literals, we compare the approximate values, that is
  // we want 0.9 and 9/10 to be considered equal)
  //
  return same(a, b);
}

export function cmp(
  a: BoxedExpression,
  b: number | BoxedExpression
): '<' | '=' | '>' | '>=' | '<=' | undefined {
  if (a.isNumberLiteral) {
    //
    // Special case when b is a plain machine number
    //
    if (typeof b !== 'number' && typeof b.numericValue === 'number')
      b = b.numericValue;
    if (typeof b === 'number') {
      if (b === 0) {
        // We could be querying the sign of a number
        const s = a.sgn;
        if (s === undefined) return undefined;
        if (s === 'zero') return '=';
        if (s === 'positive' || s === 'positive-infinity') return '>';
        if (s === 'negative' || s === 'negative-infinity') return '<';
        if (s === 'non-negative') return '>=';
        if (s === 'non-positive') return '<=';
        return undefined;
      }

      // To be mathematically equal to b, a must be a number
      if (a.isNumberLiteral) {
        const av = a.numericValue!;
        if (typeof av === 'number') {
          if (av === b) return '=';
          return av < b ? '<' : '>';
        }
        if (av.eq(b)) return '=';
        return av.lt(b) ? '<' : '>';
      }
      // Comparing a number and a non-number...
      return undefined;
    }

    if (!b.isNumberLiteral) return undefined;

    const av = a.numericValue!;
    const bv = b.numericValue! as NumericValue;
    if (typeof av === 'number') {
      if (bv.eq(av)) return '=';
      if (bv.lt(av)) return '>';
      return '<';
    }
    return av.eq(bv) ? '=' : av.lt(bv) ? '<' : '>';
  }

  if (typeof b === 'number') return undefined;

  //
  // Do we have at least one function expression?
  //
  // Note: we could have `1-x` and `x` (a symbol), so they don't have
  // to both be function expressions.
  //
  if (a.ops || b.ops) {
    // If the function has a special handler for equality, use it
    const cmp = a.functionDefinition?.eq?.(a, b);
    if (cmp !== undefined) return '=';

    // Subtract the two expressions
    const diff = a.sub(b).N();

    // If the difference is not a number, we can't compare
    // For example, '1 + y' and 'x - 1' can't be compared
    if (!diff.isNumberLiteral) return undefined;

    if (typeof diff.numericValue === 'number') {
      if (diff.numericValue === 0) return '=';
      return diff.numericValue < 0 ? '<' : '>';
    }

    // We'll use the the tolerance of the engine
    const tol = a.engine.tolerance;
    if (diff.numericValue!.isZeroWithTolerance(tol)) return '=';
    return diff.numericValue!.lt(0) ? '<' : '>';
  }

  //
  // A symbol
  //
  if (a.symbol) {
    // A symbol without a value is equal to itself
    if (a.symbol === b.symbol) return '=';

    // Symbols may have special comparision handlers
    const cmp = a.symbolDefinition?.cmp?.(b);
    if (cmp) return cmp;
    const eq = a.symbolDefinition?.eq?.(b);
    if (eq === true) return '=';
    return undefined;
  }

  //
  // A string
  //
  if (a.string) {
    if (!b.string) return undefined;
    if (a.string === b.string) return '=';
    return a.string < b.string ? '<' : '>';
  }

  //
  // For tensors, only equality applies
  //
  if (a.tensor) {
    if (!b.tensor) return undefined;
    if (a.tensor.equals(b.tensor)) return '=';
    return undefined;
  }

  return undefined;
}
