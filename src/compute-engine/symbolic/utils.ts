import Complex from 'complex.js';
import Decimal from 'decimal.js';
import { complexAllowed, bignumPreferred } from '../boxed-expression/utils';
import { isMachineRational, isBigRational } from '../numerics/rationals';
import { BoxedExpression, Hold, Rational } from '../public';

/**
 * Return a rational coef and constant such that `coef * mod + constant = expr`
 */
// export function multiple(
//   expr: BoxedExpression,
//   mod: BoxedExpression
// ): [coef: [number, number], constant: BoxedExpression] {
//   if (expr.head === 'Negate') {
//     const [coef, constant] = multiple(expr.op1, mod);
//     return [[-coef[0], coef[1]], constant];
//   }

//   if (expr.head === 'Multiply') {
//     // @todo
//   }

//   if (expr.head === 'Divide') {
//     // @todo
//   }

//   if (expr.head === 'Add') {
//     // @todo
//   }

//   return [[0, 1], expr];
// }

/**
 * Return a coef, term and constant such that:
 *
 * `coef * term + constant = expr`
 *
 * Return null if no `coef`/`constant` can be found.
 */
// export function linear(expr: BoxedExpression): null | {
//   coef: [number, number];
//   term: BoxedExpression;
//   constant: [number, number];
// } {
//   // @todo
//   return { coef: [1, 1], term: expr, constant: [0, 1] };
// }

/**
 * Apply the operator `op` to the left-hand-side and right-hand-side
 * expression. Applies the associativity rule specified by the definition,
 * i.e. 'op(a, op(b, c))` -> `op(a, b, c)`, etc...
 *
 */
export function applyAssociativeOperator(
  op: string,
  lhs: BoxedExpression,
  rhs: BoxedExpression,
  associativity: 'right' | 'left' | 'non' | 'both' = 'both'
): BoxedExpression {
  const ce = lhs.engine;

  if (associativity === 'non') return ce.fn(op, [lhs, rhs]);

  const lhsName = lhs.head;
  const rhsName = rhs.head;

  if (associativity === 'left') {
    if (lhsName === op) return ce.fn(op, [...(lhs.ops ?? []), rhs]);
    return ce.fn(op, [lhs, rhs]);
  }

  if (associativity === 'right') {
    if (rhsName === op) return ce.fn(op, [lhs, ...(rhs.ops ?? [])]);
    return ce.fn(op, [lhs, rhs]);
  }

  // Associativity: 'both'
  if (lhsName === op && rhsName === op) {
    return ce.fn(op, [...(lhs.ops ?? []), ...(rhs.ops ?? [])]);
  }
  if (lhsName === op) return ce.fn(op, [...(lhs.ops ?? []), rhs]);
  if (rhsName === op) return ce.fn(op, [lhs, ...(rhs.ops ?? [])]);
  return ce.fn(op, [lhs, rhs]);
}

// @todo: replace usage with asCoefficient():
// it does the same thing, but also extracts any literal coefficient
export function makePositive(
  expr: BoxedExpression
): [sign: number, expr: BoxedExpression] {
  if (expr.head === 'Negate') return [-1, expr.op1];

  const n = expr.numericValue;
  if (n === null) return [1, expr];

  const ce = expr.engine;

  if (typeof n === 'number' && n < 0) return [-1, ce.number(-n)];

  if (n instanceof Decimal && n.isNegative()) return [-1, ce.number(n.neg())];

  // Make the part positive if the real part is negative
  if (n instanceof Complex && n.re < 0)
    return [-1, ce.number(ce.complex(-n.re, -n.im))];

  if (isMachineRational(n) && n[0] < 0) return [-1, ce.number([-n[0], n[1]])];
  if (isBigRational(n) && n[0] < 0) return [-1, ce.number([-n[0], n[1]])];

  return [1, expr];
}

export function apply(
  expr: BoxedExpression,
  fn: (x: number) => number | Complex,
  bigFn?: (x: Decimal) => Decimal | Complex | number,
  complexFn?: (x: Complex) => number | Complex
): number | Decimal | Complex {
  const n = expr.numericValue!;
  const ce = expr.engine;
  console.assert(n !== null);

  if (typeof n === 'number') {
    if (bignumPreferred(ce) && bigFn) return ce.chop(bigFn(ce.bignum(n)));
    return ce.chop(fn(n));
  }

  if (n instanceof Decimal) return ce.chop(bigFn?.(n) ?? fn(n.toNumber()));

  if (isMachineRational(n)) {
    if (!bignumPreferred(ce) || !bigFn) return ce.chop(fn(n[0] / n[1]));
    return ce.chop(bigFn(ce.bignum(n[0]).div(n[1])));
  }
  if (isBigRational(n)) {
    if (bigFn) return ce.chop(bigFn(ce.bignum(n[0]).div(ce.bignum(n[1]))));
    return ce.chop(fn(Number(n[0]) / Number(n[1])));
  }

  if (n instanceof Complex) {
    if (!complexFn || !complexAllowed(ce)) return NaN;
    return ce.chop(complexFn(n));
  }

  debugger;
  return NaN;
}

export function applyN(
  expr: BoxedExpression,
  fn: (x: number) => number | Complex,
  bigFn?: (x: Decimal) => Decimal | Complex | number,
  complexFn?: (x: Complex) => number | Complex
): BoxedExpression | undefined {
  if ((expr?.numericValue ?? null) === null) return undefined;
  return expr.engine.number(apply(expr, fn, bigFn, complexFn));
}

export function apply2(
  expr1: BoxedExpression,
  expr2: BoxedExpression,
  fn: (x1: number, x2: number) => number | Complex | Rational,
  bigFn?: (x1: Decimal, x2: Decimal) => Decimal | Complex | Rational | number,
  complexFn?: (x1: Complex, x2: number | Complex) => Complex | number
): number | Decimal | Complex | Rational {
  console.assert(expr1.numericValue !== null && expr2.numericValue !== null);

  const ce = expr1.engine;

  let m1 = expr1.numericValue;
  if (isMachineRational(m1)) m1 = m1[0] / m1[1];

  let m2 = expr2.numericValue;
  if (isMachineRational(m2)) m2 = m2[0] / m2[1];

  if (!bignumPreferred(ce) && typeof m1 === 'number' && typeof m2 === 'number')
    return fn(m1, m2);

  let b1: Decimal | undefined = undefined;
  if (m1 instanceof Decimal) b1 = m1;
  else if (isBigRational(m1)) b1 = ce.bignum(m1[0]).div(ce.bignum(m1[1]));
  else if (m1 !== null && typeof m1 === 'number') b1 = ce.bignum(m1);

  let b2: Decimal | undefined = undefined;
  if (m2 instanceof Decimal) b2 = m2;
  else if (isBigRational(m2)) b1 = ce.bignum(m2[0]).div(ce.bignum(m2[1]));
  else if (m2 !== null && typeof m2 === 'number') b2 = ce.bignum(m2);

  if (b1 && b2) return bigFn?.(b1, b2) ?? fn(b1.toNumber(), b2.toNumber());

  if (m1 instanceof Complex || m2 instanceof Complex) {
    if (!complexFn || !complexAllowed(ce)) return NaN;
    return complexFn(
      ce.complex((m1 as number) ?? b1?.toNumber() ?? NaN),
      ce.complex((m2 as number) ?? b2?.toNumber() ?? NaN)
    );
  }

  debugger;
  return NaN;
}

export function apply2N(
  expr1: BoxedExpression,
  expr2: BoxedExpression,
  fn: (x1: number, x2: number) => number | Complex | Rational,
  bigFn?: (x1: Decimal, x2: Decimal) => Decimal | Complex | number | Rational,
  complexFn?: (x1: Complex, x2: number | Complex) => Complex | number
): BoxedExpression | undefined {
  if (expr1.numericValue === null || expr2.numericValue === null)
    return undefined;
  return expr1.engine.number(apply2(expr1, expr2, fn, bigFn, complexFn));
}

export function shouldHold(skip: Hold, count: number, index: number): boolean {
  if (skip === 'all') return true;

  if (skip === 'none') return false;

  if (skip === 'first') return index === 0;

  if (skip === 'rest') return index !== 0;

  if (skip === 'last') return index === count;

  if (skip === 'most') return index !== count;

  return true;
}

export function canonical(xs: BoxedExpression[]): BoxedExpression[] {
  // Avoid memory allocation if possible
  return xs.every((x) => x.isCanonical) ? xs : xs.map((x) => x.canonical);
}
