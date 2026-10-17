import type { Expr as Expression } from './types.js';
import { isNumber } from '../boxed-expression/type-guards.js';
import {
  polyCoeffsX,
  polyDegreeX,
  inverseFunctionOfLinear,
  substituteInverseFunction,
} from './rubi-utils.js';

/** Change t=Ln(a+b*x), including its Jacobian. Only one dependent logarithm
 * is admitted, so recursive integration cannot repeat the same substitution. */
export function logarithmicSubstitution(
  u: Expression,
  x: string
): { integrand: Expression; back: Expression } | null {
  // A speculative exponential coordinate can strand a rational subproblem
  // with symbolic coefficients. Leave those on their existing rule paths.
  if (u.unknowns.some((name) => name !== x)) return null;
  const v = inverseFunctionOfLinear(u, x);
  if (v?.operator !== 'Ln') return null;
  const transformed = substituteInverseFunction(u, v, x);
  if (!transformed) return null;
  const hasLog = (e: Expression): boolean =>
    (e.operator === 'Ln' && e.has(x)) || (e.ops ?? []).some(hasLog);
  if (hasLog(transformed)) return null;
  const ce = u.engine;
  const b = polyCoeffsX(v.op1!, x)![1];
  return {
    integrand: ce.function('Multiply', [
      transformed,
      ce.function('Divide', [ce.function('Exp', [ce.symbol(x)]), b]),
    ]),
    back: v,
  };
}

/** Integrate P(x)*exp(a+b*x)*sin/cos(c+d*x) by a finite coefficient recurrence.
 * Rational slopes make the determinant test exact, including the zero case. */
export function polynomialExponentialTrig(
  u: Expression,
  x: string
): Expression | null {
  const ce = u.engine;
  const factors = u.operator === 'Multiply' ? [...u.ops!] : [u];
  let exp: Expression | undefined;
  let trig: Expression | undefined;
  const rest: Expression[] = [];
  for (const f of factors) {
    if (
      (f.operator === 'Power' && f.op1?.isSame(ce.E)) ||
      f.operator === 'Exp'
    ) {
      if (exp) return null;
      exp = f;
    } else if (['Sin', 'Cos', 'sin', 'cos'].includes(f.operator)) {
      if (trig) return null;
      trig = f;
    } else rest.push(f);
  }
  if (!exp || !trig) return null;
  const exponent = exp.operator === 'Exp' ? exp.op1! : exp.op2!;
  const affine = (e: Expression): Expression[] | null => {
    if (polyDegreeX(e, x) !== 1) return null;
    const c = polyCoeffsX(e, x);
    return c?.length === 2 && isNumber(c[1]) && c[1].isRational === true
      ? c
      : null;
  };
  const e = affine(exponent);
  const t = affine(trig.op1!);
  if (!e || !t) return null;
  const [a, b] = [e[1], t[1]];
  const determinant = a.pow(2).add(b.pow(2));
  if (determinant.isSame(0)) return null;
  // Reject large powers before polynomial conversion can expand them.
  let nodes = 0;
  const small = (f: Expression): boolean => {
    if (++nodes > 128) return false;
    if (
      f.operator === 'Power' &&
      f.op2 &&
      isNumber(f.op2) &&
      Math.abs(f.op2.re) > 8
    )
      return false;
    return (f.ops ?? []).every(small);
  };
  if (!rest.every(small)) return null;
  const polynomial = ce.function('Multiply', rest);
  if (polyDegreeX(polynomial, x) > 8) return null;
  const p = polyCoeffsX(polynomial, x);
  if (!p || p.length > 9) return null;
  const sine = trig.operator.toLowerCase() === 'sin';
  const U: Expression[] = Array(p.length + 1).fill(ce.Zero);
  const V: Expression[] = Array(p.length + 1).fill(ce.Zero);
  for (let k = p.length - 1; k >= 0; k--) {
    const c = (sine ? ce.Zero : p[k]).sub(U[k + 1].mul(k + 1));
    const s = (sine ? p[k] : ce.Zero).sub(V[k + 1].mul(k + 1));
    U[k] = a.mul(c).sub(b.mul(s)).div(determinant);
    V[k] = b.mul(c).add(a.mul(s)).div(determinant);
  }
  const X = ce.symbol(x);
  const value = (coefficients: Expression[]): Expression =>
    ce.function(
      'Add',
      coefficients
        .slice(0, p.length)
        .map((c, i) => (i === 0 ? c : ce.function('Multiply', [c, X.pow(i)])))
    );
  return ce.function('Multiply', [
    ce.function('Exp', [exponent]),
    ce.function('Add', [
      ce.function('Multiply', [value(U), ce.function('Cos', [trig.op1!])]),
      ce.function('Multiply', [value(V), ce.function('Sin', [trig.op1!])]),
    ]),
  ]);
}
