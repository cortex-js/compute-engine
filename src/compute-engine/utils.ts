import {
  ADD,
  COMPLEX_INFINITY,
  DIVIDE,
  getArg,
  getFunctionName,
  getNumberValue,
  getSymbolName,
  getTail,
  isFunctionObject,
  MISSING,
  MULTIPLY,
  NOTHING,
  POWER,
} from '../common/utils';
import { ErrorSignal, Expression, Signal } from '../public';
import { ComputeEngine } from './public';

export class CortexError {
  signal: ErrorSignal;
  constructor(errorSignal: Signal) {
    this.signal = { severity: 'error', ...errorSignal } as ErrorSignal;
  }
  toString(): string {
    let result = '';
    if (this.signal.head) {
      result += this.signal.head + ': ';
    }

    if (typeof this.signal.message === 'string') {
      result += this.signal.message;
    } else {
      result += ' ';
      for (const arg of this.signal.message) {
        result += arg.toString() + ' ';
      }
    }

    return result;
  }
}

/** True if the expression is a number, a symbol, a string or a dictionary.
 * (in other words, not a function)
 */
export function isAtom(expr: Expression): boolean {
  return !(Array.isArray(expr) || isFunctionObject(expr));
}

export function isInteger(expr: Expression): boolean {
  // @todo
  const val = getNumberValue(expr);
  if (val === null) return false;
  return Number.isInteger(val);
}

export function isReal(expr: Expression | null): boolean {
  // @todo
  if (expr === null) return false;
  const val = getNumberValue(expr);
  if (val === null) return false;
  return true;
}

export function isZero(
  engine: ComputeEngine,
  expr: Expression
): boolean | undefined {
  const val = getNumberValue(expr);
  if (val !== null) return val === 0;
  if (engine.is(['Equal', expr, 0])) return true;
  // @todo matchAssumptions() equal not zero.
  if (engine.is(['NotEqual', expr, 0])) return false;
  if (engine.is(['Greater', expr, 0])) return false;
  if (engine.is(['Less', expr, 0])) return false;
  // @todo
  // const match = engine.matchAssumptions(['Greater', expr, '_val']);
  // if (match.some((x) => x._val > 0)) return true;

  // If this is not a number, and there are no assumptions
  // about it, we can't tell if it's zero or not.
  if (val === null) return undefined;

  // It was a number, but not 0
  return false;
}

export function isNotZero(
  engine: ComputeEngine,
  expr: Expression
): boolean | undefined {
  const result = isZero(engine, expr);
  return result === undefined ? undefined : !result;
}

export function isInfinity(
  ce: ComputeEngine,
  expr: Expression | null
): boolean | undefined {
  if (expr === null) return undefined;
  const val = getNumberValue(expr);
  if (!Number.isFinite(val)) return true;
  const symbol = getSymbolName(expr);
  if (symbol === COMPLEX_INFINITY) return true;
  if (symbol === MISSING || symbol === NOTHING) return false;
  if (ce.is(['Element', expr, 'ComplexNumber'])) return false;

  const name = getFunctionName(expr);
  if (name === 'Negate') {
    if (isInfinity(ce, getArg(expr, 1))) return true;
  } else if (name === 'Multiply') {
    const args = getTail(expr);
    if (args.some((x) => isInfinity(ce, x) === true)) {
      if (args.every((x) => isNotZero(ce, x) === true)) {
        return true;
      }
    }
  }

  return val === null ? undefined : false;
}

export function isPositive(
  ce: ComputeEngine,
  expr: Expression | null
): boolean | undefined {
  if (expr === null) return undefined;
  const val = getNumberValue(expr);
  if (val !== null) return val > 0;
  const symbol = getSymbolName(expr);
  if (
    symbol &&
    [
      'Quarter',
      'Third',
      'Half',
      'TwoThird',
      'ThreeQuarter',
      'MinusDoublePi',
      'MinusPi',
      'QuarterPi',
      'ThirdPi',
      'HalfPi',
      'TwoThirdPi',
      'ThreeQuarterPi',
      'Pi',
      'DoublePi',
      'MachineEpsilon',
      'CatalanConstant',
      'GoldenRatio',
      'EulerGamma',
      'ExponentialE',
    ].includes(symbol)
  ) {
    return true;
  }
  if (ce.is(['Greater', expr, 0])) return true;
  if (ce.is(['LessEqual', expr, 0])) return false;
  if (ce.is(['Less', expr, 0])) return false;

  const name = getFunctionName(expr);
  if (name) {
    if (name === 'Cosh' || name === 'Exp') {
      if (isReal(getArg(expr, 1))) return true;
    }
    if (name === 'Sqrt') {
      if (isPositive(ce, getArg(expr, 1))) return true;
    }
    if (name === MULTIPLY || name === ADD) {
      return getTail(expr).every((x) => isPositive(ce, x) === true);
    }
    if (name === DIVIDE) {
      if (isPositive(ce, getArg(expr, 1)) && isPositive(ce, getArg(expr, 2))) {
        return true;
      }
    }
    if (name === POWER) {
      if (isPositive(ce, getArg(expr, 1))) return true;
    }
  }

  return undefined;
}

// isOne(expr: Expression): boolean | undefined {
//   return this.equal(expr, 1);
// }
// isMinusOne(expr: Expression): boolean | undefined {
//   return this.equal(expr, -1);
// }
// /** Is `expr` >= 0? */
// isNonNegative(expr: Expression): boolean | undefined {
//   const result = this.isZero(expr);
//   if (result === undefined) return undefined;
//   if (result === true) return true;
//   return this.isPositive(expr);
// }
// /** Is `expr` > 0? */
// isPositive(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` < 0? */
// isNegative(expr: Expression): boolean | undefined {
//   const result = this.isNonNegative(expr);
//   if (result === undefined) return undefined;
//   return !result;
// }
// /** Is `expr` <= 0? */
// isNonPositive(expr: Expression): boolean | undefined {
//   const result = this.isPositive(expr);
//   if (result === undefined) return undefined;
//   return !result;
// }
// isInteger(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` an element of QQ (can be written as p/q)? */
// isRational(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` an element of RR? */
// isReal(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` an element of RR, including ±∞? */
// isExtendedReal(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` an algebraic number, i.e. not transcendental (π, e)? */
// isAlgebraic(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` a complex number? */
// isComplex(_expr: Expression): boolean | undefined {
//   // @todo
//   return undefined;
// }
// /** Is `expr` an element of `dom`? */
// isElement(_expr: Expression, _dom: Domain): boolean | undefined {
//   // @todo
//   return undefined;
// }
