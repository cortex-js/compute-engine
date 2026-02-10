import type {
  Expression,
  FunctionInterface,
  NumberLiteralInterface,
  SymbolInterface,
} from '../global-types';

/** An interval is a continuous set of real numbers */
export type Interval = {
  start: number;
  openStart: boolean;
  end: number;
  openEnd: boolean;
};

function isNumber(
  expr: Expression | null | undefined
): expr is Expression & NumberLiteralInterface {
  return expr?._kind === 'number';
}

function isSymbol(
  expr: Expression | null | undefined
): expr is Expression & SymbolInterface {
  return expr?._kind === 'symbol';
}

function isFunction(
  expr: Expression | null | undefined
): expr is Expression & FunctionInterface {
  return expr?._kind === 'function' || expr?._kind === 'tensor';
}

export function interval(expr: Expression): Interval | undefined {
  if (expr.operator === 'Interval' && isFunction(expr)) {
    let op1: Expression = expr.op1;
    let op2: Expression = expr.op2;
    let openStart = false;
    let openEnd = false;
    if (op1.operator === 'Open' && isFunction(op1)) {
      openStart = true;
      op1 = op1.op1;
    } else if (op1.operator === 'Closed' && isFunction(op1)) {
      op1 = op1.op1;
    }

    if (op2.operator === 'Open' && isFunction(op2)) {
      openEnd = true;
      op2 = op2.op1;
    } else if (op2.operator === 'Closed' && isFunction(op2)) {
      op2 = op2.op1;
    }

    const start = op1.N();
    const end = op2.N();

    if (!isNumber(start) || !isNumber(end)) return undefined;

    return { start: start.re, openStart, end: end.re, openEnd };
  }

  //
  // Known sets which are also intervals...
  //
  if (isSymbol(expr)) {
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
