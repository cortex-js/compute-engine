import type { Expression } from '../global-types.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';
import {
  getPolynomialCoefficients,
  polynomialDegree,
} from '../boxed-expression/polynomials.js';
import {
  isExactConstantExpression,
  refineExactConstants,
} from '../boxed-expression/compare.js';
import { checkDeadline } from '../../common/interruptible.js';

const MAX_DEGREE = 64;

/** Exact nonzero constants only: a floating approximation or an unresolved
 * parameter cannot establish that an exponential has an essential singularity. */
export function nonzeroResidueConstant(e: Expression): boolean {
  if (isNumber(e)) return e.isExact && e.isFinite === true && !e.isSame(0);
  if (isFunction(e, 'Multiply')) return e.ops.every(nonzeroResidueConstant);
  if (isFunction(e, 'Divide'))
    return nonzeroResidueConstant(e.op1) && nonzeroResidueConstant(e.op2);
  return (
    isExactConstantExpression(e) &&
    refineExactConstants([e], ([[lo, hi]]) =>
      lo.gt(0) || hi.lt(0) ? true : undefined
    ) === true
  );
}

function finiteConstant(e: Expression): boolean {
  if (isNumber(e)) return e.isExact && e.isFinite === true;
  if (isFunction(e) && ['Add', 'Multiply', 'Negate'].includes(e.operator))
    return e.ops.every(finiteConstant);
  if (isFunction(e, 'Divide'))
    return finiteConstant(e.op1) && nonzeroResidueConstant(e.op2);
  return (
    isExactConstantExpression(e) &&
    refineExactConstants([e], () => true) === true
  );
}

export function exponentialArgument(e: Expression): Expression | undefined {
  if (isFunction(e, 'Exp')) return e.op1;
  if (isFunction(e, 'Power') && sym(e.op1) === 'ExponentialE') return e.op2;
  return undefined;
}

/** Complete finite singularity data for P(z) exp(c/(z-a)), with polynomial
 * P and nonzero c. A zero P makes the centre removable. This does not return
 * LaurentData: there is no lowest power at an essential singularity. */
export function polynomialExponentialSingularity(
  body: Expression,
  variable: string
):
  | { point: Expression; residue: Expression; kind: 'essential' | 'removable' }
  | undefined {
  if (!body.has('ExponentialE') && !body.has('Exp')) return undefined;
  if (
    !body.isValid ||
    !body.isPure ||
    body.unknowns.some((x) => x !== variable)
  )
    return undefined;
  if (isFunction(body, 'Negate')) {
    const inner = polynomialExponentialSingularity(body.op1, variable);
    return inner ? { ...inner, residue: inner.residue.neg() } : undefined;
  }
  const ce = body.engine;
  // Keep a zero prefactor until the exponential's centre is identified;
  // numeratorDenominator may erase the exponential from 0*exp(c/(z-a)).
  const [numerator, denominator] = isFunction(body, 'Divide')
    ? [body.op1, body.op2]
    : [body, ce.One];
  if (denominator.has(variable) || !nonzeroResidueConstant(denominator))
    return undefined;
  const factors = isFunction(numerator, 'Multiply')
    ? [...numerator.ops]
    : [numerator];
  const exponentials = factors.filter((f) =>
    exponentialArgument(f)?.has(variable)
  );
  if (exponentials.length !== 1) return undefined;
  const arg = exponentialArgument(exponentials[0])!;
  const [c, q] = arg.numeratorDenominator;
  if (
    c.has(variable) ||
    !nonzeroResidueConstant(c) ||
    polynomialDegree(q, variable) !== 1
  )
    return undefined;
  const linear = getPolynomialCoefficients(q, variable);
  if (
    linear?.length !== 2 ||
    !finiteConstant(linear[0]) ||
    !nonzeroResidueConstant(linear[1])
  )
    return undefined;
  const point = ce.function('Divide', [linear[0].neg(), linear[1]]).simplify();
  const coefficient = ce.function('Divide', [c, linear[1]]).simplify();
  if (!finiteConstant(point) || !nonzeroResidueConstant(coefficient))
    return undefined;
  const prefactor = ce.function('Divide', [
    ce.function(
      'Multiply',
      factors.filter((f) => f !== exponentials[0])
    ),
    denominator,
  ]);
  const degree = polynomialDegree(prefactor, variable);
  if (degree < 0 || degree > MAX_DEGREE) return undefined;

  // Extract global polynomial coefficients first, then translate by the
  // binomial theorem. No temporary symbol can capture a user's coefficient.
  const polynomial =
    getPolynomialCoefficients(prefactor, variable) ??
    getPolynomialCoefficients(
      ce.function('ExpandAll', [prefactor]).evaluate(),
      variable
    );
  if (!polynomial || !polynomial.every(finiteConstant)) return undefined;
  if (polynomial.every((p) => p.isSame(0)))
    return { point, residue: ce.Zero, kind: 'removable' };
  if (!polynomial.some(nonzeroResidueConstant)) return undefined;
  const local: Expression[] = Array.from(
    { length: polynomial.length },
    () => ce.Zero
  );
  for (let j = 0; j < polynomial.length; j++) {
    checkDeadline(ce._deadlineFrame);
    let choose = 1n;
    for (let k = 0; k <= j; k++) {
      local[k] = ce.function('Add', [
        local[k],
        ce.function('Multiply', [
          polynomial[j],
          ce.number(choose),
          j === k ? ce.One : ce.function('Power', [point, j - k]),
        ]),
      ]);
      choose = (choose * BigInt(j - k)) / BigInt(k + 1);
    }
  }
  // P(a+t)=sum p_k t^k and exp(c/t)=sum c^n t^-n/n!.
  // Only n=k+1 contributes to t^-1, so the coefficient is a finite sum.
  let factorial = 1n;
  const terms = local.map((p, k) => {
    checkDeadline(ce._deadlineFrame);
    factorial *= BigInt(k + 1);
    return ce.function('Divide', [
      ce.function('Multiply', [p, ce.function('Power', [coefficient, k + 1])]),
      ce.number(factorial),
    ]);
  });
  const value = ce.function('Add', terms).simplify();
  return finiteConstant(value)
    ? { point, residue: value, kind: 'essential' }
    : undefined;
}
