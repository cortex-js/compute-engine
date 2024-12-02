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
  if (a.functionDefinition?.eq) {
    const cmp = a.functionDefinition.eq(a, a.engine.box(inputB));
    if (cmp !== undefined) return cmp;
  }
  if (typeof inputB !== 'number' && inputB.functionDefinition?.eq) {
    const cmp = inputB.functionDefinition.eq(inputB, a);
    if (cmp !== undefined) return cmp;
  }

  //
  // We want to compare the **value** of the boxed expressions.
  //
  a = a.N();
  const b = typeof inputB !== 'number' ? inputB.N() : a.engine.box(inputB);

  //
  // Do we have at least one function expression?
  //
  // Note: we could have `1-x` and `x` (a symbol), so they don't have
  // to both be function expressions.
  //
  if (a.ops || b.ops) {
    // If the function has a special handler for equality, use it
    let cmp = a.functionDefinition?.eq?.(a, b);
    if (cmp !== undefined) return cmp;
    cmp = b.functionDefinition?.eq?.(b, a);
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

    // If the expression have some unknowns, we can't prove equality
    return undefined;
  }

  //
  // A symbol may have special comparison handlers
  //
  if (a.symbol) {
    const cmp = a.symbolDefinition?.eq?.(b);
    if (cmp !== undefined) return cmp;
  }
  if (b.symbol) {
    const cmp = b.symbolDefinition?.eq?.(a);
    if (cmp !== undefined) return cmp;
  }
  if (a.symbol && b.symbol) return a.symbol === b.symbol;

  const ce = a.engine;

  //
  // For number literals, we compare the approximate values, that is
  // we want 0.9 and 9/10 to be considered equal
  //
  if (a.isNumberLiteral && b.isNumberLiteral) {
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
          if (Math.abs(av - b) <= a.engine.tolerance) return '=';
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

function estimateZero(expr: BoxedExpression): boolean | undefined {
  // We can only estimate if there is exactly one unknown
  if (expr.unknowns.length === 0) return undefined;
  if (expr.unknowns.length > 1) return undefined;

  const ce = expr.engine;

  // Estimate expr assuming various values for the unknown
  const values = [
    0,
    1,
    -1,
    0.5,
    -0.5,
    2,
    -2,
    0.1,
    -0.1,
    Math.PI,
    -Math.PI,
    Math.E,
    -Math.E,
  ];
  // Add a 1000 random values between -1000 and 1000
  for (let i = 0; i < 1000; i++) values.push(Math.random() * 20 - 10);

  ce.pushScope();

  const [unknown] = expr.unknowns;

  for (const value of values) {
    ce.assign(unknown, value);
    const n = expr.N();
    if (!n.isNumberLiteral) {
      ce.popScope();
      return false;
    }
    if (typeof n.numericValue === 'number') {
      if (ce.chop(n.numericValue) !== 0) {
        ce.popScope();
        return false;
      }
    } else {
      if (!n.numericValue!.isZeroWithTolerance(ce.tolerance)) {
        ce.popScope();
        return false;
      }
    }
  }

  ce.popScope();
  return true;
}

function isZeroWithTolerance(expr: BoxedExpression): boolean {
  if (!expr.isNumberLiteral) return false;
  const n = expr.numericValue!;
  const ce = expr.engine;
  if (typeof n === 'number') return ce.chop(n) === 0;
  return n.isZeroWithTolerance(ce.tolerance);
}
