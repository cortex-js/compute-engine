import { BoxedExpression } from '../public';

/** An interval is a continuous set of real numbers */
export type Interval = {
  start: number;
  openStart: boolean;
  end: number;
  openEnd: boolean;
};

export function interval(expr: BoxedExpression): Interval | undefined {
  if (expr.operator === 'Interval') {
    let op1 = expr.op1;
    let op2 = expr.op2;
    let openStart = false;
    let openEnd = false;
    if (op1.operator === 'Open') {
      openStart = true;
      op1 = op1.op1;
    } else if (op1.operator === 'Closed') {
      op1 = op1.op1;
    }

    if (op2.operator === 'Open') {
      openEnd = true;
      op2 = op2.op1;
    } else if (op2.operator === 'Closed') {
      op2 = op2.op1;
    }

    let start = op1.N();
    let end = op2.N();

    if (!start.isNumberLiteral || !end.isNumberLiteral) return undefined;

    return { start: start.re, openStart, end: end.re, openEnd };
  }

  // Known sets...
  if (expr.symbol === 'EmptySet')
    return { start: 0, openStart: true, end: 0, openEnd: true };
  else if (expr.symbol === 'RealNumbers')
    return {
      start: -Infinity,
      openStart: false,
      end: Infinity,
      openEnd: false,
    };
  else if (expr.symbol === 'NegativeNumbers')
    return { start: -Infinity, openStart: false, end: 0, openEnd: true };
  else if (expr.symbol === 'NonPositiveNumbers')
    return { start: -Infinity, openStart: false, end: 0, openEnd: false };
  else if (expr.symbol === 'PositiveNumbers')
    return { start: 0, openStart: true, end: Infinity, openEnd: false };
  else if (expr.symbol === 'NonNegativeNumbers')
    return { start: 0, openStart: false, end: Infinity, openEnd: false };
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
