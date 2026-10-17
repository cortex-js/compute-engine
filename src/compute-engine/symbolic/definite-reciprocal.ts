import type { Expression } from '../global-types.js';
import { isFunction, sym } from '../boxed-expression/type-guards.js';
import { checkDeadline } from '../../common/interruptible.js';
import { exactSign } from './contour.js';
import {
  definiteArithmetic,
  definiteUnshadowed,
  finiteConstant,
} from './definite-integrate.js';
import { boundedInteger, exactExpression } from './definite-transform.js';

/** Sparse high-degree denominators must not enter primitive-first polynomial
 * expansion. This only selects an attempt: the reducer still proves positivity
 * of the original denominator on positive reciprocal bounds before returning. */
export function hasHighDegreeReciprocalDenominator(
  f: Expression,
  x: string
): boolean {
  if (!isFunction(f, 'Divide')) return false;
  let nodes = 128;
  const large = (e: Expression): boolean => {
    if (--nodes < 0 || !e.has(x) || !isFunction(e)) return false;
    if (e.operator === 'Power' && sym(e.op1) === x)
      return boundedInteger(e.op2, 65, 8192) !== undefined;
    return e.ops.some(large);
  };
  return large(f.op2);
}

/** Pair f(x) with f(1/x)/x² on positive reciprocal bounds. Sparse Laurent
 * arithmetic proves that their sum is a Laurent polynomial without finding
 * the roots of a potentially high-degree denominator. */
export function integrateReciprocalRational(
  f: Expression,
  x: string,
  lower: Expression,
  upper: Expression
): Expression | undefined {
  if (
    !isFunction(f, 'Divide') ||
    !f.isPure ||
    !lower.isPure ||
    !upper.isPure ||
    !definiteUnshadowed(f) ||
    ![f, lower, upper].every(exactExpression) ||
    ![lower, upper].every(finiteConstant) ||
    exactSign(lower) !== 1 ||
    exactSign(upper) !== 1
  )
    return undefined;
  const ce = f.engine,
    op = definiteArithmetic(ce);
  if (!op('Multiply', lower, upper).isSame(1)) return undefined;
  const direction = exactSign(op('Subtract', upper, lower));
  if (direction === undefined) return undefined;
  const lo = direction < 0 ? upper : lower,
    hi = direction < 0 ? lower : upper;
  type Polynomial = Map<number, Expression>;
  let work = 4096;
  const add = (out: Polynomial, degree: number, value: Expression): boolean => {
    checkDeadline(ce._deadlineFrame);
    if (--work < 0 || !Number.isSafeInteger(degree) || Math.abs(degree) > 32768)
      return false;
    const sum = op('Add', out.get(degree) ?? ce.Zero, value);
    if (sum.isSame(0)) out.delete(degree);
    else out.set(degree, sum);
    return out.size <= 64;
  };
  const multiply = (a: Polynomial, b: Polynomial): Polynomial | undefined => {
    const out: Polynomial = new Map();
    for (const [i, u] of a)
      for (const [j, v] of b)
        if (!add(out, i + j, op('Multiply', u, v))) return undefined;
    return out;
  };
  const parse = (e: Expression): Polynomial | undefined => {
    if (--work < 0) return undefined;
    if (!e.has(x))
      return finiteConstant(e) && exactSign(e) !== undefined
        ? new Map(e.isSame(0) ? [] : [[0, e]])
        : undefined;
    if (sym(e) === x) return new Map([[1, ce.One]]);
    if (!isFunction(e)) return undefined;
    if (e.operator === 'Add') {
      const out: Polynomial = new Map();
      for (const term of e.ops) {
        const p = parse(term);
        if (!p) return undefined;
        for (const [i, c] of p) if (!add(out, i, c)) return undefined;
      }
      return out;
    }
    if (e.operator === 'Multiply' || e.operator === 'Negate') {
      let out: Polynomial | undefined = new Map([
        [0, e.operator === 'Negate' ? ce.NegativeOne : ce.One],
      ]);
      for (const term of e.ops) {
        const p = parse(term);
        if (!p || !(out = multiply(out, p))) return undefined;
      }
      return out;
    }
    if (e.operator === 'Power' && sym(e.op1) === x) {
      const n = boundedInteger(e.op2, -8192, 8192);
      return n === undefined ? undefined : new Map([[n, ce.One]]);
    }
    // Only monomial divisors are safe here: cancellation of a general divisor
    // could hide a pole in the original expression.
    if (e.operator === 'Divide') {
      const a = parse(e.op1),
        b = parse(e.op2);
      if (!a || !b || b.size !== 1) return undefined;
      const [j, v] = [...b][0];
      const out: Polynomial = new Map();
      for (const [i, u] of a)
        if (!add(out, i - j, op('Divide', u, v))) return undefined;
      return out;
    }
    return undefined;
  };
  const numerator = parse(f.op1),
    denominator = parse(f.op2);
  if (!numerator || !denominator?.size) return undefined;
  // Nonzero coefficients of one sign certify a nonvanishing denominator for
  // every positive x, including both endpoints. No numerical root sampling.
  const signs = [...denominator.values()].map(exactSign);
  if (!signs.every((s) => s === 1) && !signs.every((s) => s === -1))
    return undefined;
  const reciprocal = (p: Polynomial, shift = 0): Polynomial =>
    new Map([...p].map(([i, c]) => [shift - i, c]));
  const denominatorReversed = reciprocal(denominator);
  const dividend = multiply(numerator, denominatorReversed),
    other = multiply(reciprocal(numerator, -2), denominator),
    divisor = multiply(denominator, denominatorReversed);
  if (!dividend || !other || !divisor?.size) return undefined;
  for (const [i, c] of other) if (!add(dividend, i, c)) return undefined;
  const quotient: Polynomial = new Map();
  const top = Math.max(...divisor.keys()),
    bottom = Math.min(...divisor.keys());
  // Exact sparse long division, bounded by terms, not polynomial degree.
  // A nonzero remainder declines; it never supplies an approximate identity.
  for (let step = 0; dividend.size && step < 32; step++) {
    const degree = Math.max(...dividend.keys());
    const offset = degree - top;
    if (offset + bottom < Math.min(...dividend.keys())) return undefined;
    const coefficient = op('Divide', dividend.get(degree)!, divisor.get(top)!);
    if (!add(quotient, offset, coefficient)) return undefined;
    for (const [i, c] of divisor)
      if (
        !add(dividend, i + offset, op('Negate', op('Multiply', coefficient, c)))
      )
        return undefined;
    if (dividend.has(degree)) return undefined;
  }
  if (dividend.size) return undefined;
  const terms: Expression[] = [];
  for (const [n, c] of quotient) {
    const moment =
      n === -1
        ? op('Ln', op('Divide', hi, lo))
        : op(
            'Divide',
            op('Subtract', op('Power', hi, n + 1), op('Power', lo, n + 1)),
            n + 1
          );
    terms.push(op('Multiply', c, moment));
  }
  return op('Multiply', direction, op('Divide', op('Add', ...terms), 2));
}
