import type { Expression } from '../global-types.js';
import { isFunction } from '../boxed-expression/type-guards.js';
import {
  getPolynomialCoefficients,
  polynomialDegree,
} from '../boxed-expression/polynomials.js';
import { exactSign } from './contour.js';
import {
  definiteArithmetic,
  definiteUnshadowed,
  finiteConstant,
} from './definite-integrate.js';
import { boundedInteger, exactExpression } from './definite-transform.js';

/** Polynomial interactions of selectors sharing an affine phase. Ceil(u)
 * equals floor(u)+1 off a finite jump set. Restricting the surrounding algebra
 * to polynomials makes those exceptional point values irrelevant to integration;
 * this rewrite must never be used in a denominator or singular outer function. */
export function integrateDiscreteAlgebra(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): Expression | undefined {
  if (
    !f.has(['Floor', 'Ceil', 'Fract']) ||
    !f.isPure ||
    !definiteUnshadowed(f) ||
    !exactExpression(f) ||
    !finiteConstant(lower) ||
    !finiteConstant(upper)
  )
    return undefined;
  const ce = f.engine,
    op = definiteArithmetic(ce);
  let phase: Expression | undefined,
    count = 0,
    nodes = 96;
  let name = '_discrete_cell';
  while (f.has(name) || ce.lookupDefinition(name)) name += '_';
  const cell = ce.symbol(name);
  const rewrite = (e: Expression): Expression | undefined => {
    if (--nodes < 0) return undefined;
    if (!e.has(x)) return finiteConstant(e) ? e : undefined;
    if (!isFunction(e)) return e;
    if (['Floor', 'Ceil', 'Fract'].includes(e.operator)) {
      if (phase && !phase.isSame(e.op1)) return undefined;
      phase = e.op1;
      count++;
      return e.operator === 'Floor'
        ? cell
        : e.operator === 'Ceil'
          ? op('Add', cell, 1)
          : op('Subtract', phase, cell);
    }
    if (e.operator === 'Power') {
      if (boundedInteger(e.op2, 0, 8) === undefined) return undefined;
      const base = rewrite(e.op1);
      return base ? op('Power', base, e.op2) : undefined;
    }
    if (!['Add', 'Multiply', 'Negate'].includes(e.operator)) return undefined;
    const args = e.ops.map(rewrite);
    return args.every((a) => a !== undefined)
      ? ce.function(e.operator, args as Expression[])
      : undefined;
  };
  const reduced = rewrite(f);
  if (!reduced || !phase || count < 2) return undefined;
  if (
    polynomialDegree(phase, x) !== 1 ||
    polynomialDegree(reduced, name) > 8 ||
    polynomialDegree(reduced, x) > 8
  )
    return undefined;
  const affine = getPolynomialCoefficients(phase, x);
  if (
    !affine ||
    affine.length !== 2 ||
    !affine.every(finiteConstant) ||
    ![1, -1].includes(exactSign(affine[1]) ?? 0)
  )
    return undefined;
  const polynomial = getPolynomialCoefficients(reduced, name);
  if (!polynomial || polynomial.length > 9) return undefined;
  const values: Expression[] = [];
  for (let k = 0; k < polynomial.length; k++) {
    const weight = getPolynomialCoefficients(polynomial[k], x);
    if (!weight || weight.length > 9) return undefined;
    const body =
      k === 0
        ? polynomial[k]
        : op(
            'Multiply',
            polynomial[k],
            op('Power', ce.function('Floor', [phase]), k)
          );
    // Every child has at most one selector, so this route cannot recur.
    const value = ce
      .function('Integrate', [
        body,
        ce.function('Limits', [ce.symbol(x), lower, upper]),
      ])
      .evaluate();
    if (
      value.has(['Integrate', 'Limit', 'EvaluateAt']) ||
      value.isNaN ||
      !exactExpression(value)
    )
      return undefined;
    values.push(value);
  }
  return op('Add', ...values);
}

/** Cellwise integration of floor(u)/u telescopes into n*log(u)-log(n!).
 * Fract and Ceil follow by linearity. Positive affine phases avoid the pole
 * at zero; at integer endpoints the two adjacent primitive formulas agree. */
export function integrateDiscreteReciprocal(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): Expression | undefined {
  if (
    !isFunction(f, 'Divide') ||
    !isFunction(f.op1) ||
    !['Floor', 'Ceil', 'Fract'].includes(f.op1.operator) ||
    !f.op1.op1.isSame(f.op2) ||
    !f.isPure ||
    !definiteUnshadowed(f) ||
    !exactExpression(f) ||
    !finiteConstant(lower) ||
    !finiteConstant(upper)
  )
    return undefined;
  const ce = f.engine,
    op = definiteArithmetic(ce),
    phase = f.op2;
  if (polynomialDegree(phase, x) !== 1) return undefined;
  const affine = getPolynomialCoefficients(phase, x);
  if (
    !affine ||
    affine.length !== 2 ||
    !affine.every(finiteConstant) ||
    ![1, -1].includes(exactSign(affine[1]) ?? 0)
  )
    return undefined;
  const primitive = (endpoint: Expression): Expression | undefined => {
    const u = phase.subs({ [x]: endpoint }).evaluate();
    if (exactSign(u) !== 1) return undefined;
    const floor = op('Floor', u),
      n = boundedInteger(floor, 0, 4096);
    if (
      n === undefined ||
      ![0, 1].includes(exactSign(op('Subtract', u, floor)) ?? -1) ||
      exactSign(op('Subtract', n + 1, u)) !== 1
    )
      return undefined;
    const value = op(
      'Subtract',
      op('Multiply', n, op('Ln', u)),
      op('Ln', op('Factorial', n))
    );
    return f.op1.operator === 'Floor'
      ? value
      : f.op1.operator === 'Ceil'
        ? op('Add', value, op('Ln', u))
        : op('Subtract', u, value);
  };
  const a = primitive(lower),
    b = primitive(upper);
  return a && b ? op('Divide', op('Subtract', b, a), affine[1]) : undefined;
}
