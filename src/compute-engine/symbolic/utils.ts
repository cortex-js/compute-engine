import Complex from 'complex.js';
import { Decimal } from 'decimal.js';
import { complexAllowed, bignumPreferred } from '../boxed-expression/utils';
import {
  isMachineRational,
  isBigRational,
  Rational,
} from '../numerics/rationals';
import {
  BoxedExpression,
  Hold,
  IComputeEngine,
  SemiBoxedExpression,
} from '../public';
import { _BoxedExpression } from '../boxed-expression/abstract-boxed-expression';

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

export function semiCanonical(
  ce: IComputeEngine,
  xs: ReadonlyArray<SemiBoxedExpression>
): ReadonlyArray<BoxedExpression> {
  if (!xs.every((x) => x instanceof _BoxedExpression))
    return xs.map((x) => ce.box(x));

  // Avoid memory allocation if possible
  return (xs as ReadonlyArray<BoxedExpression>).every((x) => x.isCanonical)
    ? (xs as ReadonlyArray<BoxedExpression>)
    : ((xs as ReadonlyArray<BoxedExpression>).map(
        (x) => x.canonical
      ) as ReadonlyArray<BoxedExpression>);
}

export function canonical(
  xs: ReadonlyArray<BoxedExpression>
): ReadonlyArray<BoxedExpression> {
  if (!xs.every((x) => x instanceof _BoxedExpression))
    return xs.map((x) => x.canonical);
  // Avoid memory allocation if possible
  return xs.every((x) => x instanceof _BoxedExpression && x.isCanonical)
    ? xs
    : xs.map((x) => x.canonical);
}
