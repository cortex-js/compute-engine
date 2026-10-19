import type { Expression } from '../global-types.js';
import { isFunction, sym } from '../boxed-expression/type-guards.js';
import { checkDeadline } from '../../common/interruptible.js';
import { shadowsLibraryName } from '../library-shadowing.js';
import { exactSign } from './contour.js';
import { definiteArithmetic, finiteConstant } from './definite-integrate.js';
import {
  boundedInteger,
  exactBeta,
  exactExpression,
  multiplicativeFactors,
  type DefiniteReduction,
} from './definite-transform.js';

function binomial(n: number, k: number): number {
  let result = 1;
  for (let j = 1; j <= k; j++) result = (result * (n - j + 1)) / j;
  return result;
}

/** Positive integer/half-integer polygamma values follow from the recurrence
 * ψ^(m)(z+1)=ψ^(m)(z)+(-1)^m m!/z^(m+1). Other positive arguments stay exact. */
export function exactPolygamma(m: number, z: Expression): Expression {
  const ce = z.engine,
    op = definiteArithmetic(ce);
  const twice = boundedInteger(op('Multiply', 2, z), 1, 8192);
  if (twice === undefined) return op('PolyGamma', m, z);
  const half = twice % 2 === 1;
  let value =
    m === 0
      ? op(
          'Subtract',
          op('Negate', ce.symbol('EulerGamma')),
          half ? op('Multiply', 2, op('Ln', 2)) : 0
        )
      : op(
          'Multiply',
          (-1) ** (m + 1),
          op('Factorial', m),
          half ? 2 ** (m + 1) - 1 : 1,
          op('Zeta', m + 1)
        );
  for (let t = half ? 1 : 2; t < twice; t += 2) {
    checkDeadline(ce._deadlineFrame);
    value = op(
      'Add',
      value,
      op(
        'Divide',
        op('Multiply', (-1) ** m, op('Factorial', m)),
        op('Power', op('Divide', t, 2), m + 1)
      )
    );
  }
  return value;
}
const psi = exactPolygamma;

/** Introducing c in log(1+c*x^r)/x gives a rational derivative with respect
 * to c; the value at c=0 fixes the integration constant. The positive-base
 * domain c*b^r>=-1 selects the real dilogarithm, including the integrable
 * logarithmic endpoint at equality. */
export function logarithmicParameter(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): DefiniteReduction | undefined {
  const ce = f.engine,
    op = definiteArithmetic(ce);
  const reverse = upper.isSame(0);
  const lo = reverse ? upper : lower,
    hi = reverse ? lower : upper;
  if (
    !lo.isSame(0) ||
    !finiteConstant(hi) ||
    exactSign(hi) !== 1 ||
    shadowsLibraryName(ce, 'PolyLog')
  )
    return undefined;
  const fs = multiplicativeFactors(f);
  if (!fs) return undefined;
  let log: Expression | undefined,
    p = ce.Zero;
  const constants: Expression[] = [];
  for (const [base, power] of fs) {
    if (!base.has(x)) {
      if (
        !finiteConstant(base) ||
        exactSign(base) === undefined ||
        !power.isInteger
      )
        return undefined;
      constants.push(op('Power', base, power));
    } else if (sym(base) === x) p = op('Add', p, power);
    else if (isFunction(base, 'Ln') && power.isSame(1) && !log) log = base.op1;
    else return undefined;
  }
  if (
    !p.isSame(-1) ||
    !log ||
    !isFunction(log, 'Add') ||
    log.nops !== 2 ||
    !log.ops.some((t) => t.isSame(1))
  )
    return undefined;
  const term = log.ops.find((t) => !t.isSame(1))!;
  const factors = multiplicativeFactors(term);
  if (!factors) return undefined;
  const vars = factors.filter(([v]) => v.has(x));
  if (vars.length !== 1 || sym(vars[0][0]) !== x || exactSign(vars[0][1]) !== 1)
    return undefined;
  const r = vars[0][1],
    endpoint = term.subs({ [x]: hi }).evaluate();
  if (![0, 1].includes(exactSign(op('Add', 1, endpoint)) ?? -1))
    return undefined;
  const value = op(
    'Multiply',
    reverse ? 1 : -1,
    ...constants,
    op('Divide', op('PolyLog', 2, op('Negate', endpoint)), r)
  );
  return exactExpression(value)
    ? {
        value,
        steps: [
          {
            method: 'logarithmic-parameter',
            conditions: [
              'positive substitution exponent',
              'real logarithm throughout open interval',
              'zero-parameter normalization',
              'integrable endpoint logarithm',
            ],
          },
        ],
      }
    : undefined;
}

/** Mixed parameter derivatives of Euler's Beta integral. For a,b>0, any
 * fixed finite logarithmic moment is dominated on a neighborhood of (a,b)
 * by integrable endpoint powers with logarithms, justifying differentiation. */
export function betaLogMoment(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): DefiniteReduction | undefined {
  const ce = f.engine,
    op = definiteArithmetic(ce);
  const reverse = lower.isSame(1) && upper.isSame(0);
  if (!(lower.isSame(0) && upper.isSame(1)) && !reverse) return undefined;
  if (
    ['Beta', 'Gamma', 'PolyGamma', 'Zeta', 'EulerGamma'].some((h) =>
      shadowsLibraryName(ce, h)
    )
  )
    return undefined;
  const factors = multiplicativeFactors(f);
  if (!factors) return undefined;
  const complement = op('Subtract', 1, ce.symbol(x));
  let p = ce.Zero,
    q = ce.Zero,
    j = 0,
    k = 0;
  const constants: Expression[] = [];
  for (const [base, power] of factors) {
    if (
      power.has(x) ||
      !finiteConstant(power) ||
      exactSign(power) === undefined
    )
      return undefined;
    if (!base.has(x)) {
      if (
        !finiteConstant(base) ||
        exactSign(base) === undefined ||
        (!power.isInteger && exactSign(base) !== 1)
      )
        return undefined;
      constants.push(op('Power', base, power));
    } else if (sym(base) === x) p = op('Add', p, power);
    else if (base.isSame(complement)) q = op('Add', q, power);
    else if (isFunction(base, 'Ln')) {
      const n = boundedInteger(power, 0, 6);
      if (n === undefined) return undefined;
      if (sym(base.op1) === x) j += n;
      else if (base.op1.isSame(complement)) k += n;
      else return undefined;
    } else return undefined;
  }
  if (j + k === 0 || j + k > 6) return undefined;
  const a = op('Add', p, 1),
    b = op('Add', q, 1);
  if (exactSign(a) !== 1 || exactSign(b) !== 1) return undefined;
  const memo = new Map<string, Expression>();
  const logDerivative = (u: number, v: number): Expression =>
    op(
      'Subtract',
      op('Add', v === 0 ? psi(u - 1, a) : 0, u === 0 ? psi(v - 1, b) : 0),
      psi(u + v - 1, op('Add', a, b))
    );
  // Differentiate B'=B*(log B)' using the multivariate Leibniz rule. Divide
  // out B throughout, so a large factorial ratio is constructed only once.
  const normalized = (u: number, v: number): Expression => {
    if (u + v === 0) return ce.One;
    const key = `${u},${v}`;
    if (memo.has(key)) return memo.get(key)!;
    const terms: Expression[] = [];
    if (u > 0) {
      for (let i = 0; i < u; i++)
        for (let h = 0; h <= v; h++) {
          checkDeadline(ce._deadlineFrame);
          terms.push(
            op(
              'Multiply',
              binomial(u - 1, i),
              binomial(v, h),
              logDerivative(i + 1, h),
              normalized(u - 1 - i, v - h)
            )
          );
        }
    } else
      for (let h = 0; h < v; h++)
        terms.push(
          op(
            'Multiply',
            binomial(v - 1, h),
            logDerivative(0, h + 1),
            normalized(0, v - 1 - h)
          )
        );
    const value = op('Add', ...terms).simplify();
    memo.set(key, value);
    return value;
  };
  const value = op(
    'Multiply',
    reverse ? -1 : 1,
    ...constants,
    exactBeta(a, b),
    normalized(j, k)
  ).simplify();
  return exactExpression(value)
    ? {
        value,
        steps: [
          {
            method: 'beta-parameter-derivatives',
            conditions: [
              'positive Beta parameters',
              'locally integrable dominating endpoint powers',
              `mixed derivative orders ${j},${k}`,
            ],
          },
        ],
      }
    : undefined;
}
