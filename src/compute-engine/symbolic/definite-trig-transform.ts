import type { Expression } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import {
  getPolynomialCoefficients,
  polynomialDegree,
} from '../boxed-expression/polynomials.js';
import { reduceIntegrationRational } from './integration-rational.js';
import { checkDeadline } from '../../common/interruptible.js';
import { normalizeIntegrationFunctions } from './integration-normalize.js';
import { exactSign } from './contour.js';
import {
  continuousRange,
  definiteArithmetic,
  definiteUnshadowed,
  finiteConstant,
} from './definite-integrate.js';
import {
  boundedInteger,
  exactExpression,
  type DefiniteReduction,
  multiplicativeFactors,
} from './definite-transform.js';

/** Rational functions of one affine sine/cosine phase become rational in
 * t=tan(phase/2). Split at every chart pole, not at sampled sign changes.
 * The original continuous enclosure excludes real integrand poles. */
export function integrateRationalTrig(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): DefiniteReduction | undefined {
  f = normalizeIntegrationFunctions(f) ?? f;
  const ce = f.engine,
    op = definiteArithmetic(ce);
  if (
    ce.angularUnit !== 'rad' ||
    !f.has('Divide') ||
    !f.has(['Sin', 'Cos']) ||
    !f.isPure ||
    !lower.isPure ||
    !upper.isPure ||
    !definiteUnshadowed(f) ||
    !exactExpression(f) ||
    !finiteConstant(lower) ||
    !finiteConstant(upper)
  )
    return undefined;
  let phase: Expression | undefined,
    nodes = 128;
  const rational = (e: Expression): boolean => {
    if (--nodes < 0) return false;
    if (!e.has(x)) return finiteConstant(e) && exactSign(e) !== undefined;
    if (!isFunction(e)) return false;
    if (e.operator === 'Sin' || e.operator === 'Cos') {
      if (phase && !phase.isSame(e.op1)) return false;
      phase = e.op1;
      return true;
    }
    if (e.operator === 'Power')
      return boundedInteger(e.op2, -16, 16) !== undefined && rational(e.op1);
    return (
      ['Add', 'Multiply', 'Divide', 'Negate'].includes(e.operator) &&
      e.ops.every(rational)
    );
  };
  if (!rational(f) || !phase) return undefined;
  if (polynomialDegree(phase, x) !== 1) return undefined;
  const coefficients = getPolynomialCoefficients(phase, x);
  if (
    !coefficients ||
    coefficients.length !== 2 ||
    exactSign(coefficients[1]) === undefined ||
    exactSign(coefficients[1]) === 0
  )
    return undefined;
  const order = exactSign(op('Subtract', upper, lower));
  if (
    (order !== 1 && order !== -1) ||
    !continuousRange(f, x, order > 0 ? lower : upper, order > 0 ? upper : lower)
  )
    return undefined;
  const start = phase.subs({ [x]: lower }).evaluate(),
    end = phase.subs({ [x]: upper }).evaluate();
  // When the total sine/cosine degree is even, t=tan(phase) is smaller
  // than the half-angle quotient. Certify a single tangent chart first.
  const factors = multiplicativeFactors(f),
    cosineRange = continuousRange(
      ce.function('Cos', [phase]),
      x,
      order > 0 ? lower : upper,
      order > 0 ? upper : lower
    );
  if (
    factors &&
    cosineRange &&
    (exactSign(cosineRange[0]) === 1 || exactSign(cosineRange[1]) === -1)
  ) {
    let sine = 0,
      cosine = 0,
      valid = true;
    const constants: Expression[] = [];
    for (const [base, exponent] of factors) {
      const n = boundedInteger(exponent, -8, 8);
      if (!base.has(x)) constants.push(op('Power', base, exponent));
      else if (
        n !== undefined &&
        isFunction(base) &&
        base.op1.isSame(phase) &&
        ['Sin', 'Cos'].includes(base.operator)
      ) {
        if (base.operator === 'Sin') sine += n;
        else cosine += n;
      } else valid = false;
    }
    if (
      valid &&
      (sine + cosine) % 2 === 0 &&
      Math.abs(sine) + Math.abs(cosine) <= 12
    ) {
      let name = '_tangent_monomial';
      while (f.has(name) || ce.lookupDefinition(name)) name += '_';
      const t = ce.symbol(name),
        exponent = -(sine + cosine) / 2 - 1;
      const body = op(
        'Multiply',
        ...constants,
        sine === 0 ? ce.One : op('Power', t, sine),
        exponent === 0
          ? ce.One
          : op('Power', op('Add', 1, op('Power', t, 2)), exponent)
      );
      const result = ce
        .function('Integrate', [
          body,
          ce.function('Limits', [t, op('Tan', start), op('Tan', end)]),
        ])
        .evaluate();
      if (
        !result.has(['Integrate', 'Limit', 'EvaluateAt']) &&
        !result.isNaN &&
        result.isFinite !== false &&
        exactExpression(result)
      )
        return {
          value: op('Divide', result, coefficients[1]),
          steps: [
            {
              method: 'tangent-monomial',
              conditions: [
                'even total integer degree',
                'continuous original integrand',
                'single tangent chart',
              ],
            },
          ],
        };
    }
  }
  const direction = exactSign(op('Subtract', end, start));
  if (direction !== 1 && direction !== -1) return undefined;
  const lo = direction > 0 ? start : end,
    hi = direction > 0 ? end : start;
  const twoPi = op('Multiply', 2, ce.Pi);
  const chart = (v: Expression): number | undefined => {
    const t = op('Divide', op('Subtract', v, ce.Pi), twoPi);
    const n = boundedInteger(op('Floor', t), -1024, 1024);
    if (
      n === undefined ||
      ![0, 1].includes(exactSign(op('Subtract', t, n)) ?? -1) ||
      exactSign(op('Subtract', n + 1, t)) !== 1
    )
      return undefined;
    return n;
  };
  const first = chart(lo),
    last = chart(hi);
  if (first === undefined || last === undefined || last - first > 16)
    return undefined;
  const cuts: Expression[] = [lo];
  for (let n = first; n <= last + 1; n++) {
    const cut = op('Multiply', 2 * n + 1, ce.Pi);
    if (
      exactSign(op('Subtract', cut, lo)) === 1 &&
      exactSign(op('Subtract', hi, cut)) === 1
    )
      cuts.push(cut);
  }
  cuts.push(hi);
  let name = '_integration_t';
  while (f.has(name) || ce.lookupDefinition(name)) name += '_';
  const t = ce.symbol(name),
    square = op('Power', t, 2),
    den = op('Add', 1, square);
  const replace = (e: Expression): Expression => {
    if (!e.has(x) || !isFunction(e)) return e;
    if (e.operator === 'Sin') return op('Divide', op('Multiply', 2, t), den);
    if (e.operator === 'Cos')
      return op('Divide', op('Subtract', 1, square), den);
    return ce.function(e.operator, e.ops.map(replace));
  };
  const transformed = reduceIntegrationRational(
    op('Multiply', replace(f), op('Divide', 2, den)),
    name
  );
  if (!transformed) return undefined;
  const endpoint = (v: Expression, right: boolean): Expression => {
    const n = chart(v);
    if (n !== undefined && v.isSame(op('Multiply', 2 * n + 1, ce.Pi)))
      return right ? ce.PositiveInfinity : ce.NegativeInfinity;
    return op('Tan', op('Divide', v, 2));
  };
  const values: Expression[] = [];
  for (let i = 1; i < cuts.length; i++) {
    checkDeadline(ce._deadlineFrame);
    const value = ce
      .function('Integrate', [
        transformed,
        ce.function('Limits', [
          t,
          endpoint(cuts[i - 1], false),
          endpoint(cuts[i], true),
        ]),
      ])
      .evaluate();
    if (
      value.has(['Integrate', 'Limit', 'EvaluateAt']) ||
      value.isFinite === false ||
      value.isNaN ||
      !exactExpression(value)
    )
      return undefined;
    values.push(value);
  }
  return {
    value: op(
      'Divide',
      op('Multiply', direction, op('Add', ...values)),
      coefficients[1]
    ),
    steps: [
      {
        method: 'tangent-half-angle',
        substitution: phase,
        conditions: [
          'real continuous original integrand',
          'one affine phase',
          `${cuts.length - 1} monotone coordinate intervals`,
        ],
      },
    ],
  };
}
