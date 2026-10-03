import type { Expression } from '../global-types.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { freshSymbol } from './series.js';
import { exactComplexParts } from './contour.js';
import { checkDeadline } from '../../common/interruptible.js';
import { polynomialDegree } from '../boxed-expression/polynomials.js';

function parity(e: Expression, variable: string): 1 | -1 | undefined {
  if (!e.has(variable)) return 1;
  if (isSymbol(e)) return e.symbol === variable ? -1 : 1;
  if (!isFunction(e)) return undefined;
  const p = e.ops.map((x) => parity(x, variable));
  if (p.some((x) => x === undefined)) return undefined;
  if (['Add', 'Subtract'].includes(e.operator))
    return p.every((x) => x === p[0]) ? p[0] : undefined;
  if (['Multiply', 'Divide'].includes(e.operator))
    return p.reduce<1 | -1>((a, b) => (a === b ? 1 : -1), 1);
  if (['Negate', 'Sin', 'Sinh'].includes(e.operator)) return p[0];
  if (['Cos', 'Cosh'].includes(e.operator)) return 1;
  if (e.operator === 'Power' && Number.isSafeInteger(e.op2.re))
    return e.op2.re % 2 === 0 ? 1 : p[0];
  return undefined;
}

/** Standard real-variable reductions whose transformed contour and convergence
 * can be checked by the residue driver. No principal value is inferred. */
export function definiteIntegralByResidues(
  integrand: Expression,
  variable: string,
  lower: Expression,
  upper: Expression
): Expression | undefined {
  const ce = integrand.engine;
  if (!integrand.isPure || !lower.isPure || !upper.isPure) return undefined;
  const lo = lower.evaluate();
  const hi = upper.evaluate();
  const halfLine =
    (lo.isSame(0) && hi.isInfinity === true && hi.im === 0) ||
    (hi.isSame(0) && lo.isInfinity === true && lo.im === 0);
  const twoPi = ce.function('Multiply', [2, ce.Pi]);
  const period =
    (lo.isSame(0) && hi.isSame(twoPi)) || (hi.isSame(0) && lo.isSame(twoPi));
  const halfPeriod =
    (lo.isSame(0) && hi.isSame(ce.Pi)) || (hi.isSame(0) && lo.isSame(ce.Pi));
  if (!halfLine && !period && !halfPeriod) return undefined;

  const v = freshSymbol(integrand, variable);
  ce.pushScope();
  try {
    ce.declare(v, 'complex');
    const z = ce.symbol(v);
    const body = integrand.subs({ [variable]: z });
    if (halfLine) {
      // Symmetry alone is insufficient: the full-line driver must also prove
      // convergence and reject every real-axis pole before division by two.
      if (parity(body, v) !== 1) return undefined;
      const report = ce.contourIntegrate(body, v, { kind: 'real-line' });
      if (report.status === 'pole-on-contour') return ce.Indeterminate;
      if (!report.value) return undefined;
      const forward = lo.isSame(0)
        ? hi.sgn === 'positive'
        : lo.sgn === 'negative';
      return report.value.mul(forward ? ce.Half : ce.Half.neg()).simplify();
    }
    if (ce.angularUnit !== 'rad') return undefined;
    // For a 2π-periodic even function, the two half-periods are equal.
    // Odd functions do not qualify: their full-period integral can be zero
    // while their integral on [0, π] is nonzero.
    if (halfPeriod && parity(body, v) !== 1) return undefined;

    // z = exp(i theta), dtheta = dz/(i z). Only rational combinations of
    // sin(theta), cos(theta), and exact constants are accepted; bare theta,
    // noninteger powers, and branch-dependent functions cannot use this map.
    let budget = 128;
    type Fraction = { n: Expression; d: Expression };
    const convert = (e: Expression): Fraction | undefined => {
      checkDeadline(ce._deadlineFrame);
      if (--budget < 0) return undefined;
      if (!e.has(v))
        return exactComplexParts(e) ? { n: e, d: ce.One } : undefined;
      if (!isFunction(e)) return undefined;
      if (e.operator === 'Sin' || e.operator === 'Cos') {
        if (!isSymbol(e.op1) || e.op1.symbol !== v) return undefined;
        return {
          n: ce.function(e.operator === 'Cos' ? 'Add' : 'Subtract', [
            z.pow(2),
            ce.One,
          ]),
          d: ce.function(
            'Multiply',
            e.operator === 'Cos' ? [2, z] : [2, ce.I, z]
          ),
        };
      }
      if (
        !['Add', 'Subtract', 'Multiply', 'Divide', 'Negate', 'Power'].includes(
          e.operator
        )
      )
        return undefined;
      if (
        e.operator === 'Power' &&
        (!Number.isSafeInteger(e.op2.re) || Math.abs(e.op2.re) > 64)
      )
        return undefined;
      const args = e.ops.map(convert);
      if (args.some((x) => !x)) return undefined;
      const [a, b] = args as Fraction[];
      if (e.operator === 'Negate') return { n: a.n.neg(), d: a.d };
      if (e.operator === 'Divide') return { n: a.n.mul(b.d), d: a.d.mul(b.n) };
      if (e.operator === 'Power') {
        const k = e.op2.re;
        return k >= 0
          ? { n: a.n.pow(k), d: a.d.pow(k) }
          : { n: a.d.pow(-k), d: a.n.pow(-k) };
      }
      if (e.operator === 'Multiply')
        return (args as Fraction[]).reduce((a, b) => ({
          n: a.n.mul(b.n),
          d: a.d.mul(b.d),
        }));
      return (args as Fraction[]).reduce((a, b) => ({
        n: ce.function(e.operator, [a.n.mul(b.d), b.n.mul(a.d)]),
        d: a.d.mul(b.d),
      }));
    };
    const mapped = convert(body);
    if (!mapped) return undefined;
    // Check before expansion: nested powers can exceed the pole solver's
    // degree budget even when the original expression has very few nodes.
    if (
      polynomialDegree(mapped.n, v) > 64 ||
      polynomialDegree(mapped.d, v) > 63
    )
      return undefined;
    const rational = ce.function('Divide', [
      ce.function('Expand', [mapped.n.mul(ce.I.neg())]).evaluate(),
      // Preserve polynomial powers: expanding a repeated quadratic into a
      // quartic can hide its exactly known roots from the general solver.
      mapped.d.mul(z),
    ]);
    const report = ce.contourIntegrate(rational, v, {
      kind: 'circle',
      center: 0,
      radius: 1,
    });
    if (report.status === 'pole-on-contour') return ce.Indeterminate;
    if (!report.value) return undefined;
    const value = halfPeriod
      ? report.value.mul(ce.Half).simplify()
      : report.value;
    return lo.isSame(0) ? value : value.neg();
  } finally {
    ce.popScope();
  }
}
