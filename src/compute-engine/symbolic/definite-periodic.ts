import type { Expression } from '../global-types.js';
import { isFunction, sym } from '../boxed-expression/type-guards.js';
import { getPolynomialCoefficients } from '../boxed-expression/polynomials.js';
import { shadowsLibraryName } from '../library-shadowing.js';
import { checkDeadline } from '../../common/interruptible.js';
import { exactSign } from './contour.js';
import {
  definiteArithmetic,
  definiteUnshadowed,
  finiteConstant,
} from './definite-integrate.js';
import { boundedInteger, exactExpression } from './definite-transform.js';

function choose(n: number, k: number): number {
  let value = 1;
  for (let i = 1; i <= k; i++) value = (value * (n - i + 1)) / i;
  return value;
}

/** Polynomially weighted periodic moments use Faulhaber's recurrence, not a
 * loop over periods. Its polynomial identity extends to negative cell indices
 * as an oriented sum, so one primitive works on both sides of zero. */
export function integrateWeightedDiscrete(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): Expression | undefined {
  if (
    !f.has(['Floor', 'Ceil', 'Fract']) ||
    !f.isPure ||
    !lower.isPure ||
    !upper.isPure ||
    !definiteUnshadowed(f) ||
    !exactExpression(f)
  )
    return undefined;
  const ce = f.engine,
    op = definiteArithmetic(ce);
  // In polynomial identities the zeroth monomial is 1, including at zero;
  // CE's general-purpose 0^0 is deliberately indeterminate.
  const monomial = (v: Expression, n: number) =>
    n === 0 ? ce.One : op('Power', v, n);
  const factors = isFunction(f, 'Multiply')
    ? f.ops
    : isFunction(f, 'Negate')
      ? [ce.NegativeOne, f.op1]
      : [f];
  const selectors = factors.filter((t) => t.has(['Floor', 'Ceil', 'Fract']));
  if (selectors.length !== 1) return undefined;
  const selector = selectors[0],
    base = isFunction(selector, 'Power') ? selector.op1 : selector;
  const power = isFunction(selector, 'Power')
    ? boundedInteger(selector.op2, 1, 8)
    : 1;
  if (power === undefined || !isFunction(base)) return undefined;
  let kind = base.operator,
    argument: Expression | undefined;
  if (['Floor', 'Ceil', 'Fract'].includes(kind)) argument = base.op1;
  else if (kind === 'Add') {
    for (const t of base.ops)
      if (
        isFunction(t, 'Negate') &&
        isFunction(t.op1, 'Floor') &&
        op('Subtract', base, op('Subtract', t.op1.op1, t.op1))
          .simplify()
          .isSame(0)
      ) {
        kind = 'Fract';
        argument = t.op1.op1;
        break;
      }
  }
  if (!argument) return undefined;
  const weight = op('Multiply', ...factors.filter((t) => t !== selector));
  const polynomial = getPolynomialCoefficients(weight, x);
  if (
    !polynomial ||
    polynomial.length > 9 ||
    !polynomial.every((c) => finiteConstant(c) && exactSign(c) !== undefined)
  )
    return undefined;
  let lo = lower,
    hi = upper,
    direction = 1;
  if (upper.isSame(0)) {
    lo = upper;
    hi = lower;
    direction = -1;
  }
  // Layer-cake: floor(c/x)=sum_{n>=1} 1_{x<=c/n}. For x^(s-1),
  // s>1, positivity permits termwise integration, giving c^s*zeta(s)/s.
  if (
    power === 1 &&
    lo.isSame(0) &&
    isFunction(argument, 'Divide') &&
    sym(argument.op2) === x &&
    argument.op1.isSame(hi) &&
    exactSign(hi) === 1 &&
    finiteConstant(hi) &&
    !shadowsLibraryName(ce, 'Zeta')
  ) {
    if (!polynomial[0].isSame(0)) return undefined;
    const terms: Expression[] = [];
    for (let i = 1; i < polynomial.length; i++) {
      const s = i + 1;
      const floor = op('Divide', op('Zeta', s), s);
      const moment =
        kind === 'Floor'
          ? floor
          : kind === 'Ceil'
            ? op('Add', floor, op('Divide', 1, s))
            : op('Subtract', op('Divide', 1, i), floor);
      terms.push(op('Multiply', polynomial[i], op('Power', hi, s), moment));
    }
    return op('Multiply', direction, op('Add', ...terms));
  }
  if (!finiteConstant(lower) || !finiteConstant(upper)) return undefined;
  const affine = getPolynomialCoefficients(argument, x);
  if (
    !affine ||
    affine.length !== 2 ||
    !affine.every((c) => finiteConstant(c) && exactSign(c) !== undefined) ||
    exactSign(affine[1]) === 0
  )
    return undefined;
  const [offset, slope] = affine;
  const coefficients: Expression[] = [];
  for (let k = 0; k < polynomial.length; k++) {
    const terms: Expression[] = [];
    for (let i = k; i < polynomial.length; i++)
      terms.push(
        op(
          'Divide',
          op(
            'Multiply',
            polynomial[i],
            choose(i, k),
            monomial(op('Negate', offset), i - k)
          ),
          monomial(slope, i)
        )
      );
    coefficients.push(op('Add', ...terms));
  }
  const primitive = (v: Expression): Expression | undefined => {
    const u = op('Add', offset, op('Multiply', slope, v));
    const n = op('Floor', u);
    if (
      !n.isInteger ||
      !exactExpression(n) ||
      !finiteConstant(n) ||
      ![0, 1].includes(exactSign(op('Subtract', u, n)) ?? -1) ||
      exactSign(op('Subtract', op('Add', n, 1), u)) !== 1
    )
      return undefined;
    const tail = op('Subtract', u, n);
    const sums: Expression[] = [n];
    for (let d = 1; d <= power + polynomial.length; d++) {
      checkDeadline(ce._deadlineFrame);
      sums.push(
        op(
          'Divide',
          op(
            'Subtract',
            op('Power', n, d + 1),
            op(
              'Add',
              ...sums.map((s, j) => op('Multiply', choose(d + 1, j), s))
            )
          ),
          d + 1
        )
      );
    }
    const values: Expression[] = [];
    for (let k = 0; k < coefficients.length; k++) {
      const terms: Expression[] = [];
      for (let h = 0; h <= k; h++) {
        if (kind === 'Fract')
          terms.push(
            op(
              'Multiply',
              choose(k, h),
              op(
                'Divide',
                op(
                  'Add',
                  sums[k - h],
                  op(
                    'Multiply',
                    monomial(n, k - h),
                    monomial(tail, h + power + 1)
                  )
                ),
                h + power + 1
              )
            )
          );
        else
          for (let j = kind === 'Floor' ? power : 0; j <= power; j++)
            terms.push(
              op(
                'Multiply',
                choose(k, h),
                kind === 'Floor' ? 1 : choose(power, j),
                op(
                  'Divide',
                  op(
                    'Add',
                    sums[k - h + j],
                    op(
                      'Multiply',
                      monomial(n, k - h + j),
                      monomial(tail, h + 1)
                    )
                  ),
                  h + 1
                )
              )
            );
      }
      values.push(op('Multiply', coefficients[k], op('Add', ...terms)));
    }
    return op('Divide', op('Add', ...values), slope);
  };
  const a = primitive(lower),
    b = primitive(upper);
  return a && b ? op('Subtract', b, a) : undefined;
}
