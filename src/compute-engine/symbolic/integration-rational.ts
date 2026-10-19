import type { Expression } from '../global-types.js';
import { isFunction, sym } from '../boxed-expression/type-guards.js';
import {
  getPolynomialCoefficients,
  cancelCommonFactors,
} from '../boxed-expression/polynomials.js';
import { rationalPartsAsWritten } from '../boxed-expression/rational-body.js';
import { expand } from '../boxed-expression/expand.js';
import { boundedInteger } from './definite-transform.js';
import { definiteArithmetic } from './definite-integrate.js';

/** Canonicalize small transformed rational expressions only. Bound the degrees
 * before constructing common denominators or expanding; nesting small powers
 * is not itself a bound on polynomial work. This is a coordinate-algebra helper,
 * not a certificate that cancelled factors were nonzero in the original domain. */
export function reduceIntegrationRational(
  f: Expression,
  x: string
): Expression | undefined {
  let nodes = 128;
  const degrees = (e: Expression): [number, number] => {
    if (--nodes < 0) return [Infinity, Infinity];
    if (!e.has(x)) return [0, 0];
    if (sym(e) === x) return [1, 0];
    if (!isFunction(e)) return [Infinity, Infinity];
    if (e.operator === 'Negate') return degrees(e.op1);
    if (e.operator === 'Power') {
      const n = boundedInteger(e.op2, -24, 24);
      if (n === undefined) return [Infinity, Infinity];
      const d = degrees(e.op1);
      return n < 0 ? [d[1] * -n, d[0] * -n] : [d[0] * n, d[1] * n];
    }
    if (e.operator === 'Divide') {
      const a = degrees(e.op1),
        b = degrees(e.op2);
      return [a[0] + b[1], a[1] + b[0]];
    }
    if (e.operator === 'Multiply')
      return e.ops
        .map(degrees)
        .reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
    if (e.operator === 'Add')
      return e.ops
        .map(degrees)
        .reduce(([a, b], [c, d]) => [Math.max(a + d, b + c), b + d], [0, 0]);
    return [Infinity, Infinity];
  };
  if (degrees(f).some((d) => !Number.isFinite(d) || d > 24)) return undefined;
  const parts = rationalPartsAsWritten(f);
  if (!parts) return undefined;
  const ce = f.engine,
    op = definiteArithmetic(ce),
    t = ce.symbol(x);
  const polynomials = parts.map((part) => {
    const evaluated = part.evaluate();
    const coefficients = getPolynomialCoefficients(
      (expand(evaluated) ?? evaluated).evaluate(),
      x
    );
    if (!coefficients || coefficients.length > 25) return undefined;
    return op(
      'Add',
      ...coefficients.map((c, k) =>
        op('Multiply', c, k === 0 ? ce.One : op('Power', t, k))
      )
    );
  });
  return polynomials.every((p) => p !== undefined)
    ? cancelCommonFactors(
        ce.function('Divide', polynomials as Expression[]),
        x
      ).simplify()
    : undefined;
}
