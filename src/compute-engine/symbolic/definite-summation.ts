import type { Expression } from '../global-types.js';
import { isFunction, sym } from '../boxed-expression/type-guards.js';
import { getPolynomialCoefficients } from '../boxed-expression/polynomials.js';
import { shadowsLibraryName } from '../library-shadowing.js';
import { checkDeadline } from '../../common/interruptible.js';
import { exactSign } from './contour.js';
import {
  continuousRange,
  definiteArithmetic,
  finiteConstant,
} from './definite-integrate.js';
import {
  boundedInteger,
  exactExpression,
  multiplicativeFactors,
  type DefiniteReduction,
} from './definite-transform.js';
import { exactPolygamma } from './definite-parameter.js';

function zeta(s: number, a: Expression): Expression {
  const op = definiteArithmetic(a.engine);
  return a.isSame(1) ? op('Zeta', s) : op('HurwitzZeta', s, a);
}

/** J(a)=integral_0^1 t^(a-1)/(1+t) dt satisfies J(a+1)=1/a-J(a).
 * J(1)=log(2) and J(1/2)=pi/2 preserve elementary rational-kernel answers
 * without leaving digamma differences at quarter arguments unevaluated. */
function alternatingZerothMoment(a: Expression): Expression {
  const ce = a.engine,
    op = definiteArithmetic(ce),
    twice = boundedInteger(op('Multiply', 2, a), 1, 8192);
  if (twice !== undefined) {
    const half = twice % 2 === 1;
    let value = half ? op('Divide', ce.Pi, 2) : op('Ln', 2);
    for (let t = half ? 1 : 2; t < twice; t += 2) {
      checkDeadline(ce._deadlineFrame);
      value = op('Subtract', op('Divide', 2, t), value);
    }
    return value;
  }
  return op(
    'Divide',
    op(
      'Subtract',
      exactPolygamma(0, op('Divide', op('Add', a, 1), 2)),
      exactPolygamma(0, op('Divide', a, 2))
    ),
    2
  );
}

/** Mellin moments of geometric kernels. For the minus denominator, m>=1
 * and p>-1 give an absolutely integrable series, even though it is not
 * uniformly convergent at x=1. The plus denominator at m=0 instead uses a
 * convergent digamma difference, avoiding subtraction of divergent zeta(1). */
export function logarithmicSeriesMoment(
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
    ['Zeta', 'HurwitzZeta', 'PolyGamma', 'EulerGamma'].some((h) =>
      shadowsLibraryName(ce, h)
    )
  )
    return undefined;
  const factors = multiplicativeFactors(f);
  if (!factors) return undefined;
  let p = ce.Zero,
    m = 0,
    r: Expression | undefined,
    sign: number | undefined;
  const constants: Expression[] = [];
  for (const [base, power] of factors) {
    if (!base.has(x)) {
      if (
        !finiteConstant(base) ||
        exactSign(base) === undefined ||
        !power.isInteger
      )
        return undefined;
      constants.push(op('Power', base, power));
    } else if (sym(base) === x) p = op('Add', p, power);
    else if (isFunction(base, 'Ln') && sym(base.op1) === x) {
      const order = boundedInteger(power, 0, 8);
      if (order === undefined) return undefined;
      m += order;
    } else if (
      power.isSame(-1) &&
      isFunction(base, 'Add') &&
      base.nops === 2 &&
      base.ops.some((t) => t.isSame(1)) &&
      !r
    ) {
      const term = base.ops.find((t) => !t.isSame(1))!;
      const fs = multiplicativeFactors(term);
      if (!fs) return undefined;
      const vars = fs.filter(([v]) => v.has(x));
      if (vars.length !== 1 || sym(vars[0][0]) !== x) return undefined;
      r = vars[0][1];
      const coefficient = op(
        'Multiply',
        ...fs.filter(([v]) => !v.has(x)).map(([v, k]) => op('Power', v, k))
      );
      if (coefficient.isSame(1)) sign = 1;
      else if (coefficient.isSame(-1)) sign = -1;
      else return undefined;
    } else return undefined;
  }
  if (
    !r ||
    sign === undefined ||
    m > 8 ||
    exactSign(r) !== 1 ||
    exactSign(op('Add', p, 1)) !== 1 ||
    (sign === -1 && m === 0)
  )
    return undefined;
  const a = op('Divide', op('Add', p, 1), r),
    s = m + 1;
  const series =
    sign === -1
      ? zeta(s, a)
      : m === 0
        ? alternatingZerothMoment(a)
        : a.isSame(1)
          ? op('Multiply', op('Subtract', 1, op('Power', 2, -m)), op('Zeta', s))
          : op(
              'Divide',
              op(
                'Subtract',
                zeta(s, op('Divide', a, 2)),
                zeta(s, op('Divide', op('Add', a, 1), 2))
              ),
              op('Power', 2, s)
            );
  const value = op(
    'Multiply',
    reverse ? -1 : 1,
    ...constants,
    (-1) ** m,
    op('Divide', op('Multiply', op('Factorial', m), series), op('Power', r, s))
  ).simplify();
  return exactExpression(value)
    ? {
        value,
        steps: [
          {
            method: 'logarithmic-geometric-moment',
            conditions: [
              'positive Mellin parameter',
              sign === -1
                ? 'absolutely integrable geometric expansion'
                : 'convergent alternating moment',
            ],
          },
        ],
      }
    : undefined;
}

/** Nonnegative power series x^(r*(n+a)-1)/(n+a)^k, n=N..∞.
 * Its integral is zeta(k+1,N+a)/r for r,a>0 and integer k>=1. */
export function integratedPowerSeries(
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
    !isFunction(f, 'Sum') ||
    !isFunction(f.op2, 'Limits') ||
    f.op2.nops !== 3 ||
    !f.op2.op3.isSame(ce.PositiveInfinity) ||
    ['Zeta', 'HurwitzZeta'].some((h) => shadowsLibraryName(ce, h))
  )
    return undefined;
  const index = sym(f.op2.op1),
    start = boundedInteger(f.op2.op2, 0, 1024);
  if (!index || index === x || start === undefined) return undefined;
  const fs = multiplicativeFactors(f.op1);
  if (!fs || fs.length !== 2) return undefined;
  const xp = fs.find(([v]) => sym(v) === x),
    denominator = fs.find((t) => t !== xp);
  if (!xp || !denominator) return undefined;
  const exponent = getPolynomialCoefficients(xp[1], index),
    shift = getPolynomialCoefficients(denominator[0], index);
  const k = boundedInteger(op('Negate', denominator[1]), 1, 8);
  if (
    !exponent ||
    exponent.length !== 2 ||
    !shift ||
    shift.length !== 2 ||
    !shift[1].isSame(1) ||
    k === undefined
  )
    return undefined;
  const r = exponent[1],
    a = shift[0];
  if (
    a.has(x) ||
    r.has(x) ||
    exactSign(r) !== 1 ||
    exactSign(op('Add', a, start)) !== 1 ||
    !op('Subtract', op('Add', exponent[0], 1), op('Multiply', r, a))
      .simplify()
      .isSame(0)
  )
    return undefined;
  return {
    value: op(
      'Divide',
      op('Multiply', reverse ? -1 : 1, zeta(k + 1, op('Add', a, start))),
      r
    ),
    steps: [
      {
        method: 'termwise-positive-power-series',
        conditions: [
          'nonnegative summands',
          'finite zeta majorant',
          'matching Mellin exponent',
        ],
      },
    ],
  };
}

/** Finite telescoping products of an affine nonzero factor. Proving its
 * enclosure over both the index and integration ranges excludes every hidden
 * zero before cancellation, independently of the number of factors. */
export function telescopingProduct(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): DefiniteReduction | undefined {
  if (
    !isFunction(f, 'Product') ||
    !isFunction(f.op2, 'Limits') ||
    f.op2.nops !== 3 ||
    !isFunction(f.op1, 'Divide')
  )
    return undefined;
  const ce = f.engine,
    op = definiteArithmetic(ce),
    limits = f.op2;
  const index = sym(limits.op1),
    a = boundedInteger(limits.op2, -1000000, 1000000),
    b = boundedInteger(limits.op3, -1000000, 1000000);
  if (
    !index ||
    index === x ||
    a === undefined ||
    b === undefined ||
    b < a ||
    !finiteConstant(lower) ||
    !finiteConstant(upper)
  )
    return undefined;
  const g = f.op1.op2,
    coefficients = getPolynomialCoefficients(g, index);
  if (
    !coefficients ||
    coefficients.length !== 2 ||
    coefficients[1].has(x) ||
    ![1, -1].includes(exactSign(coefficients[1]) ?? 0)
  )
    return undefined;
  const numerator = getPolynomialCoefficients(f.op1.op1, index);
  if (
    !numerator ||
    numerator.length !== 2 ||
    !numerator[1].isSame(coefficients[1])
  )
    return undefined;
  const shift = boundedInteger(
    op(
      'Divide',
      op('Subtract', numerator[0], coefficients[0]),
      coefficients[1]
    ).simplify(),
    1,
    8
  );
  if (shift === undefined) return undefined;
  const direction = exactSign(op('Subtract', upper, lower));
  if (direction !== 1 && direction !== -1) return undefined;
  const lo = direction > 0 ? lower : upper,
    hi = direction > 0 ? upper : lower;
  const left = continuousRange(g.subs({ [index]: ce.number(a) }), x, lo, hi);
  const right = continuousRange(
    g.subs({ [index]: ce.number(b + shift) }),
    x,
    lo,
    hi
  );
  if (
    !left ||
    !right ||
    !(
      (exactSign(left[0]) === 1 && exactSign(right[0]) === 1) ||
      (exactSign(left[1]) === -1 && exactSign(right[1]) === -1)
    )
  )
    return undefined;
  const reduced = op(
    'Divide',
    op(
      'Multiply',
      ...Array.from({ length: shift }, (_, j) =>
        g.subs({ [index]: ce.number(b + 1 + j) })
      )
    ),
    op(
      'Multiply',
      ...Array.from({ length: shift }, (_, j) =>
        g.subs({ [index]: ce.number(a + j) })
      )
    )
  );
  const value = ce
    .function('Integrate', [
      reduced,
      ce.function('Limits', [ce.symbol(x), lower, upper]),
    ])
    .evaluate();
  if (
    value.has(['Integrate', 'Limit', 'EvaluateAt']) ||
    !exactExpression(value) ||
    value.isFinite === false ||
    value.isNaN
  )
    return undefined;
  return {
    value,
    steps: [
      {
        method: 'telescoping-product',
        conditions: [
          'matching shifted factors',
          'nonzero factors throughout index and integration intervals',
        ],
      },
    ],
  };
}

/** Product g(n+1)/g(n), g(n)=1+c(x)/(n+d)^p. On a compact interval where
 * all factors are positive, bounded c and p>0 give uniform convergence of
 * g(N) to 1. The limit product is 1/g(start), so integration commutes with
 * the limit without treating arbitrary infinite products as finite ones. */
export function infiniteTelescopingProduct(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): DefiniteReduction | undefined {
  if (
    !isFunction(f, 'Product') ||
    !isFunction(f.op2, 'Limits') ||
    f.op2.nops !== 3 ||
    !isFunction(f.op1, 'Divide')
  )
    return undefined;
  const ce = f.engine,
    op = definiteArithmetic(ce),
    limits = f.op2;
  const index = sym(limits.op1),
    start = boundedInteger(limits.op2, 0, 1024);
  if (
    !index ||
    index === x ||
    start === undefined ||
    !limits.op3.isSame(ce.PositiveInfinity) ||
    !finiteConstant(lower) ||
    !finiteConstant(upper)
  )
    return undefined;
  const parse = (
    e: Expression
  ): { c: Expression; d: Expression; p: number } | undefined => {
    if (
      !isFunction(e, 'Add') ||
      e.nops !== 2 ||
      !e.ops.some((t) => t.isSame(1))
    )
      return undefined;
    const fs = multiplicativeFactors(e.ops.find((t) => !t.isSame(1))!);
    if (!fs) return undefined;
    const indices = fs.filter(([v]) => v.has(index));
    if (indices.length !== 1) return undefined;
    const p = boundedInteger(op('Negate', indices[0][1]), 1, 8);
    const poly = getPolynomialCoefficients(indices[0][0], index);
    if (
      p === undefined ||
      !poly ||
      poly.length !== 2 ||
      !poly[1].isSame(1) ||
      poly[0].has(x) ||
      exactSign(poly[0]) === undefined
    )
      return undefined;
    const c = op(
      'Multiply',
      ...fs
        .filter(([v]) => !v.has(index))
        .map(([v, power]) => op('Power', v, power))
    );
    return { c, d: poly[0], p };
  };
  const numerator = parse(f.op1.op1),
    denominator = parse(f.op1.op2);
  if (
    !numerator ||
    !denominator ||
    numerator.p !== denominator.p ||
    !numerator.c.isSame(denominator.c) ||
    !op('Subtract', numerator.d, denominator.d).isSame(1)
  )
    return undefined;
  const { c, d, p } = denominator,
    first = op('Add', start, d);
  if (exactSign(first) !== 1) return undefined;
  const direction = exactSign(op('Subtract', upper, lower));
  if (direction !== 1 && direction !== -1) return undefined;
  const range = continuousRange(
    c,
    x,
    direction > 0 ? lower : upper,
    direction > 0 ? upper : lower
  );
  if (
    !range ||
    exactSign(op('Add', 1, op('Divide', range[0], op('Power', first, p)))) !== 1
  )
    return undefined;
  const reduced = op(
    'Divide',
    1,
    op('Add', 1, op('Divide', c, op('Power', first, p)))
  );
  const value = ce
    .function('Integrate', [
      reduced,
      ce.function('Limits', [ce.symbol(x), lower, upper]),
    ])
    .evaluate();
  if (
    value.has(['Integrate', 'Limit', 'EvaluateAt']) ||
    !exactExpression(value) ||
    value.isFinite === false ||
    value.isNaN
  )
    return undefined;
  return {
    value,
    steps: [
      {
        method: 'uniformly-telescoping-infinite-product',
        conditions: [
          'positive factors',
          'bounded continuous coefficient',
          'uniform convergence on compact interval',
        ],
      },
    ],
  };
}
