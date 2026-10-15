import type { Expression } from '../global-types.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';
import { getPolynomialCoefficients } from '../boxed-expression/polynomials.js';
import { exactSign } from './contour.js';
import { shadowsLibraryName } from '../library-shadowing.js';
import { boundVariableNamesInOperand } from '../boxed-expression/binders.js';
import { checkDeadline } from '../../common/interruptible.js';

/** Known primitives of special functions with affine arguments. LogGamma is
 * the analytic logarithm, not the principal logarithm of Gamma. These are
 * local primitives; definite polygamma integrals additionally need a domain
 * check because of the poles on the non-positive integers. */
export function specialAntiderivative(
  fn: Expression,
  variable: string
): Expression | undefined {
  if (!isFunction(fn)) return undefined;
  const ce = fn.engine;
  const unary = ['Erf', 'Erfc', 'Digamma', 'Trigamma'].includes(fn.operator);
  if (
    (!unary && !['BesselJ', 'BesselI', 'PolyGamma'].includes(fn.operator)) ||
    !fn.isPure
  )
    return undefined;
  const u = unary ? fn.op1 : fn.op2;
  const coefficients = getPolynomialCoefficients(u, variable);
  if (!coefficients || coefficients.length !== 2) return undefined;
  const k = coefficients[1].evaluate();
  if (exactSign(k) === undefined || exactSign(k) === 0) return undefined;
  if (fn.operator === 'Erf' || fn.operator === 'Erfc') {
    if (shadowsLibraryName(ce, 'Pi') || shadowsLibraryName(ce, 'Exp'))
      return undefined;
    const gaussian = ce.function('Exp', [u.pow(2).neg()]).div(ce.Pi.sqrt());
    return u
      .mul(fn)
      .add(fn.operator === 'Erf' ? gaussian : gaussian.neg())
      .div(k);
  }
  if (fn.operator === 'BesselJ' || fn.operator === 'BesselI') {
    if (!fn.op1.isSame(1)) return undefined;
    const primitive = ce.function(fn.operator, [ce.Zero, u]).div(k);
    return fn.operator === 'BesselJ' ? primitive.neg() : primitive;
  }
  const order = unary ? ce.number(fn.operator === 'Digamma' ? 0 : 1) : fn.op1;
  if (!isNumber(order) || !order.isInteger || order.isNegative)
    return undefined;
  if (shadowsLibraryName(ce, order.isSame(0) ? 'LogGamma' : 'PolyGamma'))
    return undefined;
  return (
    order.isSame(0)
      ? ce.function('LogGamma', [u])
      : ce.function('PolyGamma', [order.sub(ce.One), u])
  ).div(k);
}

/** Until the general pole classifier handles polygamma's infinite pole
 * family, only definite intervals on which its affine argument is positive
 * may use these primitives. Indefinite integration is local. */
export function polygammaDomainKnown(
  fn: Expression,
  variable: string,
  lo: Expression,
  hi: Expression
): boolean {
  if (
    !isFunction(fn) ||
    !fn.has(['Digamma', 'Trigamma', 'PolyGamma']) ||
    !fn.has(variable)
  )
    return true;
  if (['Digamma', 'Trigamma', 'PolyGamma'].includes(fn.operator)) {
    const u = fn.operator === 'PolyGamma' ? fn.op2 : fn.op1;
    const p = getPolynomialCoefficients(u, variable);
    return (
      p !== null &&
      p !== undefined &&
      p.length <= 2 &&
      exactSign(u.subs({ [variable]: lo })) === 1 &&
      exactSign(u.subs({ [variable]: hi })) === 1
    );
  }
  return fn.ops.every(
    (op, i) =>
      boundVariableNamesInOperand(fn, i).includes(variable) ||
      polygammaDomainKnown(op, variable, lo, hi)
  );
}

/** Bose integrals: expand 1/(exp(a*x)-1) in positive exponentials, then
 * integrate termwise. For integer n >= 1 and real a > 0, positivity justifies
 * the exchange and the sum is n! Zeta(n+1)/a^(n+1). n=0 diverges at zero. */
export function integrateBoseMoment(
  fn: Expression,
  variable: string,
  lower: Expression,
  upper: Expression
): Expression | undefined {
  const ce = fn.engine;
  if (
    !fn.isPure ||
    !lower.isPure ||
    !upper.isPure ||
    shadowsLibraryName(ce, 'Zeta') ||
    shadowsLibraryName(ce, 'Factorial')
  )
    return undefined;
  if (isFunction(fn, 'Negate'))
    return integrateBoseMoment(fn.op1, variable, lower, upper)?.neg();
  if (isFunction(fn, 'Multiply')) {
    const factors = fn.ops.filter((x) => x.has(variable));
    if (factors.length !== 1) return undefined;
    const c = ce
      .function(
        'Multiply',
        fn.ops.filter((x) => !x.has(variable))
      )
      .evaluate();
    if (c.isFinite !== true || exactSign(c) === undefined || exactSign(c) === 0)
      return undefined;
    return integrateBoseMoment(factors[0], variable, lower, upper)
      ?.mul(c)
      .evaluate();
  }
  let reversed = false;
  if (lower.isSame(ce.PositiveInfinity) && upper.isSame(0)) reversed = true;
  else if (!lower.isSame(0) || !upper.isSame(ce.PositiveInfinity))
    return undefined;
  if (!isFunction(fn, 'Divide')) return undefined;
  checkDeadline(ce._deadlineFrame);
  const numerator = getPolynomialCoefficients(fn.op1, variable);
  if (!numerator || numerator.length === 0 || numerator.length > 33)
    return undefined;
  const n = numerator.length - 1;
  if (!numerator.slice(0, n).every((x) => x.isSame(0))) return undefined;
  const coefficient = numerator[n].evaluate();
  if (
    coefficient.isFinite !== true ||
    exactSign(coefficient) === undefined ||
    exactSign(coefficient) === 0
  )
    return undefined;
  const exponential = fn.op2.add(1).evaluate();
  const exponent = isFunction(exponential, 'Exp')
    ? exponential.op1
    : isFunction(exponential, 'Power') &&
        sym(exponential.op1) === 'ExponentialE'
      ? exponential.op2
      : undefined;
  if (!exponent) return undefined;
  const p = getPolynomialCoefficients(exponent, variable);
  if (!p || p.length !== 2 || !p[0].isSame(0) || exactSign(p[1]) !== 1)
    return undefined;
  const value =
    n === 0
      ? exactSign(coefficient) === 1
        ? ce.PositiveInfinity
        : ce.NegativeInfinity
      : coefficient
          .mul(ce.function('Factorial', [ce.number(n)]))
          .mul(ce.function('Zeta', [ce.number(n + 1)]))
          .div(p[1].pow(n + 1))
          .evaluate();
  return reversed ? value.neg() : value;
}
