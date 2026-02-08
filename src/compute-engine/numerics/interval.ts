import type { BoxedExpression } from '../global-types';
import { isBoxedSymbol, isBoxedNumber, isBoxedFunction } from '../boxed-expression/type-guards';

/** An interval is a continuous set of real numbers */
export type Interval = {
  start: number;
  openStart: boolean;
  end: number;
  openEnd: boolean;
};

export function interval(expr: BoxedExpression): Interval | undefined {
  if (expr.operator === 'Interval' && isBoxedFunction(expr)) {
    let op1: BoxedExpression = expr.op1;
    let op2: BoxedExpression = expr.op2;
    let openStart = false;
    let openEnd = false;
    if (op1.operator === 'Open' && isBoxedFunction(op1)) {
      openStart = true;
      op1 = op1.op1;
    } else if (op1.operator === 'Closed' && isBoxedFunction(op1)) {
      op1 = op1.op1;
    }

    if (op2.operator === 'Open' && isBoxedFunction(op2)) {
      openEnd = true;
      op2 = op2.op1;
    } else if (op2.operator === 'Closed' && isBoxedFunction(op2)) {
      op2 = op2.op1;
    }

    const start = op1.N();
    const end = op2.N();

    if (!isBoxedNumber(start) || !isBoxedNumber(end)) return undefined;

    return { start: start.re, openStart, end: end.re, openEnd };
  }

  //
  // Known sets which are also intervals...
  //
  if (isBoxedSymbol(expr)) {
    if (expr.symbol === 'EmptySet')
      return { start: 0, openStart: true, end: 0, openEnd: true };

    if (expr.symbol === 'RealNumbers')
      return {
        start: -Infinity,
        openStart: false,
        end: Infinity,
        openEnd: false,
      };

    if (expr.symbol === 'NegativeNumbers')
      return { start: -Infinity, openStart: false, end: 0, openEnd: true };

    if (expr.symbol === 'NonPositiveNumbers')
      return { start: -Infinity, openStart: false, end: 0, openEnd: false };

    if (expr.symbol === 'PositiveNumbers')
      return { start: 0, openStart: true, end: Infinity, openEnd: false };

    if (expr.symbol === 'NonNegativeNumbers')
      return { start: 0, openStart: false, end: Infinity, openEnd: false };
  }

  return undefined;
}

export function intervalContains(int: Interval, val: number): boolean {
  if (int.openStart) {
    if (int.start <= val) return false;
  }
  if (int.start < val) return false;
  if (int.openEnd) {
    if (int.end >= val) return false;
  }
  if (int.end > val) return false;
  return true;
}

/** Return true if int1 is a subset of int2 */
export function intervalSubset(int1: Interval, int2: Interval): boolean {
  if (int1.openStart) {
    if (int2.openStart) {
      if (int1.start <= int2.start) return false;
    } else {
      if (int1.start < int2.start) return false;
    }
  } else {
    if (int2.openStart) {
      if (int1.start <= int2.start) return false;
    } else {
      if (int1.start < int2.start) return false;
    }
  }
  if (int1.openEnd) {
    if (int2.openEnd) {
      if (int1.end >= int2.end) return false;
    } else {
      if (int1.end > int2.end) return false;
    }
  } else {
    if (int2.openEnd) {
      if (int1.end >= int2.end) return false;
    } else {
      if (int1.end > int2.end) return false;
    }
  }
  return true;
}
