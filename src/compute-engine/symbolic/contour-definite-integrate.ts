import type { Expression, IComputeEngine } from '../global-types.js';
import type { ContourIntegralResult } from '../types-contour.js';
import { isFunction, isSymbol } from '../boxed-expression/type-guards.js';
import { freshSymbol } from './series.js';
import { exactComplexParts, integerExponent } from './contour.js';
import { realPathDivergence } from './contour-integrate.js';
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
  const exponent = integerExponent(e);
  if (exponent !== undefined) return exponent % 2 === 0 ? 1 : p[0];
  return undefined;
}

/** The value of a real integral whose path goes through a pole, from the
 * `divergence` of the residue report: `+∞` or `-∞` (negated when `forward`
 * is false, that is, when the bounds are reversed), `Indeterminate` when the
 * integral has no value, and `undefined` when this could not be decided. */
export function divergentIntegralValue(
  ce: IComputeEngine,
  divergence: ContourIntegralResult['divergence'],
  forward: boolean
): Expression | undefined {
  if (divergence === 'positive-infinity' || divergence === 'negative-infinity')
    return (divergence === 'positive-infinity') === forward
      ? ce.PositiveInfinity
      : ce.NegativeInfinity;
  return divergence === 'no-value' ? ce.Indeterminate : undefined;
}

/** The value of a contour integral, from `ContourIntegrate` or
 * `CircularIntegrate`, whose path goes through a singularity. On the real
 * line, it is the value given by the `divergence` of the report. On a closed
 * contour, a pole of order m ≥ 1 on the path grows like 1/|z - p|^m, which is
 * not integrable along the path, so the integral has no value
 * (`Indeterminate`). An essential singularity on the path can have a finite
 * integral: exp(1/z) stays bounded on |z - 1| = 1, which goes through 0. So
 * when a singularity on the path is not a pole, the result is `undefined`
 * and the integral stays unevaluated. */
export function singularPathValue(
  ce: IComputeEngine,
  report: ContourIntegralResult
): Expression | undefined {
  if (report.contour?.kind === 'real-line')
    return divergentIntegralValue(ce, report.divergence, true);
  const onPath = report.poles.filter(
    (p) => p.location === 'boundary' && p.kind !== 'removable'
  );
  return onPath.length > 0 && onPath.every((p) => p.kind === 'pole')
    ? ce.Indeterminate
    : undefined;
}

/** The divergence of a period integral whose unit circle |z| = 1 goes
 * through poles of the transformed integrand g(z). Next to a pole
 * z0 = exp(i t0), z - z0 is approximately i z0 (t - t0), and the integrand in
 * t is f(t) = i z g(z). So if g(z) is approximately C/(z - z0)^m, then f(t)
 * is approximately C (i z0)^(1-m)/(t - t0)^m, which is real. */
function periodDivergence(
  ce: IComputeEngine,
  report: ContourIntegralResult
): ContourIntegralResult['divergence'] {
  const singular = report.poles.filter((p) => p.kind !== 'removable');
  // A candidate whose location is not decided may be on the path, and an
  // essential singularity on the path has no order: neither gives a verdict.
  if (singular.some((p) => p.location === 'undetermined'))
    return 'undetermined';
  const onPath = singular.filter((p) => p.location === 'boundary');
  if (onPath.some((p) => p.kind !== 'pole')) return 'undetermined';
  return realPathDivergence(
    onPath.map(({ order, leadingCoefficient, point }) => ({
      order,
      coefficient:
        order !== undefined && leadingCoefficient
          ? ce
              .function('Multiply', [
                leadingCoefficient,
                ce.function('Power', [
                  ce.function('Multiply', [ce.I, point]),
                  1 - order,
                ]),
              ])
              .evaluate()
          : undefined,
    }))
  );
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
      const forward = lo.isSame(0)
        ? hi.sgn === 'positive'
        : lo.sgn === 'negative';
      if (report.status === 'pole-on-contour')
        return divergentIntegralValue(ce, report.divergence, forward);
      if (!report.value) return undefined;
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
        Math.abs(integerExponent(e) ?? Infinity) > 64
      )
        return undefined;
      const args = e.ops.map(convert);
      if (args.some((x) => !x)) return undefined;
      const [a, b] = args as Fraction[];
      if (e.operator === 'Negate') return { n: a.n.neg(), d: a.d };
      if (e.operator === 'Divide') return { n: a.n.mul(b.d), d: a.d.mul(b.n) };
      if (e.operator === 'Power') {
        const k = integerExponent(e)!;
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
    if (report.status === 'pole-on-contour')
      return divergentIntegralValue(
        ce,
        periodDivergence(ce, report),
        lo.isSame(0)
      );
    if (!report.value) return undefined;
    const value = halfPeriod
      ? report.value.mul(ce.Half).simplify()
      : report.value;
    return lo.isSame(0) ? value : value.neg();
  } finally {
    ce.popScope();
  }
}
