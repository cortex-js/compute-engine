import {
  ADD,
  COMPLEX_INFINITY,
  DIVIDE,
  getArg,
  getFunctionName,
  getNumberValue,
  getSymbolName,
  getTail,
  MISSING,
  MULTIPLY,
  NOTHING,
  POWER,
} from '../common/utils';
import { Expression } from '../public';
import { ComputeEngine, Domain } from './public';

export function isInteger(ce: ComputeEngine, expr: Expression): boolean {
  // @todo
  const val = getNumberValue(expr);
  if (val === null) return false;
  return Number.isInteger(val);
}

export function isNumeric(
  _ce: ComputeEngine,
  _expr: Expression | null
): boolean | undefined {
  // @todo
  return false;
}

export function isZero(
  ce: ComputeEngine,
  expr: Expression
): boolean | undefined {
  const val = getNumberValue(expr);
  if (val !== null) return val === 0;

  if (ce.is(['Equal', expr, 0])) return true;
  // @todo matchAssumptions() equal not zero.
  if (ce.is(['NotEqual', expr, 0]) === true) return false;
  if (ce.is(['Greater', expr, 0]) === true) return false;
  if (ce.is(['Less', expr, 0]) === true) return false;
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
  if (val !== null && !Number.isFinite(val)) return true;
  if (val !== null && isNaN(val)) return undefined;
  const symbol = getSymbolName(expr);
  if (symbol === COMPLEX_INFINITY) return true;
  if (symbol === MISSING || symbol === NOTHING) return false;

  if (ce.is(expr, 'ComplexNumber')) return false;

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

// @todo
export function isFinite(
  _ce: ComputeEngine,
  _expr: Expression | null
): boolean | undefined {
  return undefined;
}

export function isPosInfinity(
  ce: ComputeEngine,
  expr: Expression | null
): boolean | undefined {
  const result = isInfinity(ce, expr);
  if (result === undefined) return undefined;
  if (result === false) return false;
  return isPositive(ce, expr);
}

export function isNegInfinity(
  ce: ComputeEngine,
  expr: Expression | null
): boolean | undefined {
  const result = isInfinity(ce, expr);
  if (result === undefined) return undefined;
  if (result === false) return false;
  return isNegative(ce, expr!);
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
      if (isReal(ce, getArg(expr, 1))) return true;
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

export function isOne(
  ce: ComputeEngine,
  expr: Expression
): boolean | undefined {
  return isEqual(ce, expr, 1);
}

export function isNegativeOne(
  ce: ComputeEngine,
  expr: Expression
): boolean | undefined {
  return isEqual(ce, expr, -1);
}

/** Is `expr` >= 0? */
export function isNonNegative(
  ce: ComputeEngine,
  expr: Expression
): boolean | undefined {
  const result = ce.isZero(expr);
  if (result === undefined) return undefined;
  if (result === true) return true;
  return ce.isPositive(expr);
}

/** Is `expr` < 0? */
export function isNegative(
  ce: ComputeEngine,
  expr: Expression
): boolean | undefined {
  const result = isPositive(ce, expr);
  if (result === true) return false;
  if (result === undefined) return undefined;
  if (isZero(ce, expr) === false) return true;
  return false;
}

/** Is `expr` <= 0? */
export function isNonPositive(
  ce: ComputeEngine,
  expr: Expression
): boolean | undefined {
  const result = isPositive(ce, expr);
  if (result === undefined) return undefined;
  return !result;
}

export function isReal(
  _ce: ComputeEngine,
  expr: Expression | null
): boolean | undefined {
  // @todo
  if (expr === null) return false;
  const val = getNumberValue(expr);
  if (val === null) return false;
  return true;
}
/** Is `expr` an element of RR, including ±∞? */
export function isExtendedReal(
  _ce: ComputeEngine,
  _expr: Expression
): boolean | undefined {
  // @todo
  return undefined;
}

/** Is `expr` an element of QQ (can be written as p/q)? */
export function isRational(
  _ce: ComputeEngine,
  _expr: Expression
): boolean | undefined {
  // @todo
  return undefined;
}

/** Is `expr` an algebraic number, i.e. not transcendental (π, e)? */
export function isAlgebraic(
  _ce: ComputeEngine,
  _expr: Expression
): boolean | undefined {
  // @todo
  return undefined;
}
/** Is `expr` a complex number? */
export function isComplex(
  _ce: ComputeEngine,
  _expr: Expression
): boolean | undefined {
  // @todo
  return undefined;
}
/** Is `expr` an element of `dom`? */
export function isElement(
  _ce: ComputeEngine,

  _expr: Expression,
  _set: Expression
): boolean | undefined {
  // @todo
  return undefined;
}

/** Test if `lhs` is a subset of `rhs`.
 *
 * `lhs` and `rhs` can be set expressions, i.e.
 * `["SetMinus", "ComplexNumber", 0]`
 *
 */
export function isSubsetOf(
  ce: ComputeEngine,
  lhs: Domain | null,
  rhs: Domain | null
): boolean {
  if (!lhs || !rhs) return false;
  if (typeof lhs === 'string' && lhs === rhs) return true;
  if (rhs === 'Anything') return true;
  if (rhs === 'Nothing') return false;

  //
  // 1. Set operations on lhs
  //
  // Union: lhs or rhs
  // Intersection: lhs and rhs
  // SetMinus: lhs and not rhs
  // Complement: not lhs
  const lhsFnName = getFunctionName(lhs);
  if (lhsFnName === 'Union') {
    return getTail(lhs).some((x) => isSubsetOf(ce, x, rhs));
  } else if (lhsFnName === 'Intersection') {
    return getTail(lhs).every((x) => isSubsetOf(ce, x, rhs));
  } else if (lhsFnName === 'SetMinus') {
    return (
      isSubsetOf(ce, getArg(lhs, 1), rhs) &&
      !isSubsetOf(ce, getArg(lhs, 2), rhs)
    );
    // } else if (lhsFnName === 'Complement') {
    //   return !ce.isSubsetOf(getArg(lhs, 1), rhs);
  }

  //
  // 2. Set operations on rhs
  //
  const rhsFnName = getFunctionName(rhs);
  if (rhsFnName === 'Union') {
    return getTail(rhs).some((x) => isSubsetOf(ce, lhs, x));
  } else if (rhsFnName === 'Intersection') {
    return getTail(rhs).every((x) => isSubsetOf(ce, lhs, x));
  } else if (rhsFnName === 'SetMinus') {
    return (
      isSubsetOf(ce, lhs, getArg(rhs, 1)) &&
      !isSubsetOf(ce, lhs, getArg(rhs, 2))
    );
    // } else if (rhsFnName === 'Complement') {
    //   return !ce.isSubsetOf(lhs, getArg(rhs, 1));
  }

  //
  // 3. Not a set operation: a domain or a parametric domain
  //
  const rhsDomainName = getSymbolName(rhs) ?? rhsFnName;
  if (!rhsDomainName) {
    const rhsVal = getNumberValue(rhs) ?? NaN;
    if (Number.isNaN(rhsVal)) return false;
    // If the rhs is a number, 'upgrade' it to a set singleton
    rhs = rhs === 0 ? 'NumberZero' : ['Set', rhs];
  }

  const rhsDef = ce.getSetDefinition(rhsDomainName);
  if (!rhsDef) return false;
  if (typeof rhsDef.isSubsetOf === 'function') {
    // 3.1 Parametric domain
    return rhsDef.isSubsetOf(this, lhs, rhs);
  }
  const lhsDomainName = getSymbolName(lhs) ?? lhsFnName;
  if (!lhsDomainName) return false;

  const lhsDef = ce.getSetDefinition(lhsDomainName);
  if (!lhsDef) return false;

  // 3.2 Non-parametric domain:
  for (const parent of lhsDef.supersets) {
    if (isSubsetOf(ce, parent, rhs)) return true;
  }

  return false;
}

export function isEqual(
  _ce: ComputeEngine,
  _lhs: Expression,
  _rhs: Expression
): boolean | undefined {
  //@todo
  return undefined;
}

export function isLess(
  _ce: ComputeEngine,
  _lhs: Expression,
  _rhs: Expression
): boolean | undefined {
  //@todo
  return undefined;
}
export function isLessEqual(
  _ce: ComputeEngine,
  _lhs: Expression,
  _rhs: Expression
): boolean | undefined {
  //@todo
  return undefined;
}
export function isGreater(
  _ce: ComputeEngine,
  _lhs: Expression,
  _rhs: Expression
): boolean | undefined {
  //@todo
  return undefined;
}
export function isGreaterEqual(
  _ce: ComputeEngine,
  _lhs: Expression,
  _rhs: Expression
): boolean | undefined {
  //@todo
  return undefined;
}
