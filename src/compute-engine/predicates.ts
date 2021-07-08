import {
  ADD,
  COMPLEX_INFINITY,
  DIVIDE,
  getArg,
  getComplexValue,
  getDecimalValue,
  getFunctionName,
  getNumberValue,
  getRationalValue,
  getSymbolName,
  getTail,
  MISSING,
  MULTIPLY,
  NOTHING,
  POWER,
  UNDEFINED,
} from '../common/utils';
import { Expression } from '../math-json/math-json-format';
import { checkAssumption, evaluateBoolean } from './assume';
import { isNumericSubdomain } from './dictionary/domains';
import { gcd } from './numeric';
import {
  ComputeEngine,
  Domain,
  DomainExpression,
} from '../math-json/compute-engine-interface';

export function isFunction(
  ce: ComputeEngine,
  expr: Expression | null
): boolean | undefined {
  const dom = ce.domain(expr);
  if (!dom) return undefined;
  return ce.isSubsetOf(dom, 'Function');
}

export function isNumeric(
  ce: ComputeEngine,
  expr: Expression | null
): boolean | undefined {
  const val =
    getNumberValue(expr) ?? getDecimalValue(expr) ?? getComplexValue(expr);
  if (val !== null) return true;

  const dom = ce.domain(expr);
  if (typeof dom === 'string')
    return isNumericSubdomain(dom as Domain, 'Number');
  if (dom) return ce.isSubsetOf(dom, 'Number');

  return undefined;
}

/** Is `expr` a complex number? */
export function isComplex(
  ce: ComputeEngine,
  expr: Expression
): boolean | undefined {
  const dom = ce.domain(expr);
  if (dom === null) return undefined;
  if (typeof dom === 'string')
    return isNumericSubdomain(dom as Domain, 'ComplexNumber');
  return isSubsetOf(ce, dom, 'ComplexNumber');
}

export function isReal(
  ce: ComputeEngine,
  expr: Expression
): boolean | undefined {
  const dom = ce.domain(expr);
  if (dom === null) return undefined;
  if (typeof dom === 'string')
    return isNumericSubdomain(dom as Domain, 'RealNumber');
  return isSubsetOf(ce, dom, 'RealNumber');
}

/** Is `expr` an element of RR, including ±∞? */
export function isExtendedReal(
  ce: ComputeEngine,
  expr: Expression
): boolean | undefined {
  if (expr === 'ComplexInfinity') return false;
  let result = isInfinity(ce, expr);
  if (result !== true) result = isReal(ce, expr);

  return result;
}

/** Is `expr` an element of QQ (can be written as p/q)? */
export function isRational(
  ce: ComputeEngine,
  expr: Expression
): boolean | undefined {
  const [numer, denom] = getRationalValue(expr);
  if (numer !== null && denom !== null) return true;

  const d = getDecimalValue(expr);
  if (d !== null) return d.isInteger();

  const c = getComplexValue(expr);
  // Don't need to check if it was a real, getNumberValue() would have
  // handled it.
  if (c !== null) return false;

  const dom = ce.domain(expr);
  if (dom) return ce.isSubsetOf(dom, 'RationalNumber');

  return undefined;
}

/** Is `expr` an algebraic number, i.e. not transcendental (π, e)? */
export function isAlgebraic(
  ce: ComputeEngine,
  expr: Expression
): boolean | undefined {
  // @todo
  const dom = ce.domain(expr);
  if (dom) return ce.isSubsetOf(dom, 'AlgebraicNumber');
}

export function isInteger(
  ce: ComputeEngine,
  expr: Expression
): boolean | undefined {
  const val = getNumberValue(expr);
  if (val !== null) return Number.isInteger(val);
  const d = getDecimalValue(expr);
  if (d !== null) return d.isInteger();

  const c = getComplexValue(expr);
  // Don't need to check if it was a real, getNumberValue() would have
  // handled it.
  if (c !== null) return false;

  const dom = ce.domain(expr);
  if (typeof dom === 'string')
    return isNumericSubdomain(dom as Domain, 'Integer');
  if (dom) return ce.isSubsetOf(dom, 'Integer');

  return undefined;
}

export function isZero(
  ce: ComputeEngine,
  expr: Expression
): boolean | undefined {
  const val = getNumberValue(expr);
  if (val !== null) return val === 0;

  const d = getDecimalValue(expr);
  if (d !== null) return d.isZero();

  const c = getComplexValue(expr);
  // No need to check for 0: a real number would have been handled by
  // getNumberValue()
  if (c !== null) return false;

  // `checkAssumption` require a  normalized prop
  const sym = getSymbolName(expr);
  if (sym) {
    if (checkAssumption(ce, ['Equal', sym, 0])) return true;
    if (checkAssumption(ce, ['NotEqual', sym, 0])) return false;
    if (checkAssumption(ce, ['Greater', sym, 0])) return true;
    if (checkAssumption(ce, ['Less', sym, 0])) return true;
    // @todo
    // const match = engine.matchAssumptions(['Greater', expr, '_val']);
    // if (match.some((x) => x._val > 0)) return true;
  }
  return undefined;
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
  if (symbol === MISSING || symbol === NOTHING || symbol === UNDEFINED) {
    return false;
  }

  if (checkAssumption(ce, ['Element', expr, 'ComplexNumber'])) return false;

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

export function isFinite(
  ce: ComputeEngine,
  expr: Expression | null
): boolean | undefined {
  const p = isInfinity(ce, expr);
  if (p === undefined) return p;
  return !p;
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
  if (checkAssumption(ce, ['LessEqual', expr, 0])) return false;
  if (checkAssumption(ce, ['Less', expr, 0])) return false;

  const name = getFunctionName(expr);
  if (name) {
    if (name === 'Cosh' || name === 'Exp') {
      if (isReal(ce, getArg(expr, 1) ?? MISSING)) return true;
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

/** Is `expr` an element of `set`? */
export function isElement(
  ce: ComputeEngine,
  expr: Expression,
  set: Expression
): boolean | undefined {
  //
  //

  //
  // 2/ Check assumptions
  //
  const result = evaluateBoolean(ce, ['Element', expr, set]);
  if (result === 'True') return true;
  if (result === 'False') return false;
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
  lhs: DomainExpression | null,
  rhs: DomainExpression | null
): boolean | undefined {
  if (lhs === null || rhs === null) return undefined;

  if (rhs === 'Anything') return true;

  if (rhs === 'Nothing') {
    if (isSubsetOf(ce, lhs, 'Anything')) return false;
    return undefined;
  }
  if (typeof lhs === 'string' && lhs === rhs) {
    if (isSubsetOf(ce, lhs, 'Anything')) return true;
    return undefined;
  }

  //
  // 1. Set operations on lhs
  //
  // Union: lhs or rhs
  // Intersection: lhs and rhs
  // SetMinus: lhs and not rhs
  // Complement: not lhs
  const lhsFnName = getFunctionName(lhs);
  if (lhsFnName === 'Union') {
    return getTail(lhs).some((x) => isSubsetOf(ce, x, rhs) === true);
  } else if (lhsFnName === 'Intersection') {
    return getTail(lhs).every((x) => isSubsetOf(ce, x, rhs) === true);
  } else if (lhsFnName === 'SetMinus') {
    return (
      isSubsetOf(ce, getArg(lhs, 1), rhs) === true &&
      isSubsetOf(ce, getArg(lhs, 2), rhs) === false
    );
    // } else if (lhsFnName === 'Complement') {
    //   return !ce.isSubsetOf(getArg(lhs, 1), rhs);
  }

  //
  // 2. Set operations on rhs
  //
  const rhsFnName = getFunctionName(rhs);
  if (rhsFnName === 'Union') {
    return getTail(rhs).some((x) => isSubsetOf(ce, lhs, x) === true);
  } else if (rhsFnName === 'Intersection') {
    return getTail(rhs).every((x) => isSubsetOf(ce, lhs, x) === true);
  } else if (rhsFnName === 'SetMinus') {
    return (
      isSubsetOf(ce, lhs, getArg(rhs, 1)) === true &&
      isSubsetOf(ce, lhs, getArg(rhs, 2)) === false
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
    rhs = ['Set', rhs];
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
  ce: ComputeEngine,
  lhs: Expression,
  rhs: Expression
): boolean | undefined {
  //
  // 1/ Check numeric
  //

  const val1 = getNumberValue(lhs);
  if (val1 !== null) {
    const val2 = getNumberValue(rhs);
    if (val2 !== null) return val1 === val2;
  }

  let [numer1, denom1] = getRationalValue(lhs);
  if (numer1 !== null && denom1 !== null) {
    let [numer2, denom2] = getRationalValue(rhs);
    if (numer2 !== null && denom2 !== null) {
      const gcd1 = gcd(numer1, denom1);
      [numer1, denom1] = [numer1 / gcd1, denom1 / gcd1];
      const gcd2 = gcd(numer1, denom1);
      [numer2, denom2] = [numer1 / gcd2, denom1 / gcd2];
      return numer1 === numer2 && denom1 === denom2;
    }
  }

  const d1 = getDecimalValue(lhs);
  if (d1 !== null) {
    const d2 = getDecimalValue(rhs);
    if (d2 !== null) return d1.eq(d2);
  }

  const c1 = getComplexValue(lhs);
  if (c1 !== null) {
    const c2 = getComplexValue(rhs);
    if (c2 !== null) return c1.eq(c2);
  }

  //
  // 2. Check assumptions
  //
  const result = evaluateBoolean(ce, ['Equal', lhs, rhs]);
  if (result === 'True') return true;
  if (result === 'False') return false;
  return undefined;
}

export function isLess(
  ce: ComputeEngine,
  lhs: Expression,
  rhs: Expression
): boolean | undefined {
  //
  // 1/ Check numeric
  //

  const val1 = getNumberValue(lhs);
  if (val1 !== null) {
    const val2 = getNumberValue(rhs);
    if (val2 !== null) return val1 < val2;
  }

  const [numer1, denom1] = getRationalValue(lhs);
  if (numer1 !== null && denom1 !== null) {
    const [numer2, denom2] = getRationalValue(rhs);
    if (numer2 !== null && denom2 !== null) {
      return numer1 * denom2 < numer2 * denom1;
    }
  }

  const d1 = getDecimalValue(lhs);
  if (d1 !== null) {
    const d2 = getDecimalValue(rhs);
    if (d2 !== null) return d1.lt(d2);
  }

  const c1 = getComplexValue(lhs);
  if (c1 !== null) {
    const c2 = getComplexValue(rhs);
    if (c2 !== null) return c1.lt(c2);
  }

  //
  // 2. Check assumptions
  //
  const result = evaluateBoolean(ce, ['Less', lhs, rhs]);
  if (result === 'True') return true;
  if (result === 'False') return false;
  return undefined;
}

export function isLessEqual(
  ce: ComputeEngine,
  lhs: Expression,
  rhs: Expression
): boolean | undefined {
  // @todo add a fastpath
  const eq = isEqual(ce, lhs, rhs);
  if (eq !== undefined) return true;
  return isLess(ce, lhs, rhs);
}

export function isGreater(
  ce: ComputeEngine,
  lhs: Expression,
  rhs: Expression
): boolean | undefined {
  // @todo add a fastpath
  const lt = isLess(ce, lhs, rhs);
  if (lt === undefined) return undefined;
  return !lt;
}

export function isGreaterEqual(
  ce: ComputeEngine,
  lhs: Expression,
  rhs: Expression
): boolean | undefined {
  // @todo add a fastpath
  const eq = isEqual(ce, lhs, rhs);
  if (eq !== undefined) return true;
  const lt = isLess(ce, lhs, rhs);
  if (lt === undefined) return undefined;
  return !lt;
}
