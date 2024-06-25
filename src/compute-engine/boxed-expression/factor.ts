import Complex from 'complex.js';
import Decimal from 'decimal.js';

import {
  Rational,
  isBigRational,
  isRational,
  isRationalInteger,
  isRationalNegativeOne,
  isRationalOne,
  isRationalZero,
  machineNumerator,
  neg,
  pow,
  reduceRationalSquareRoot,
} from '../numerics/rationals';
import { gcd } from '../numerics/numeric';
import { BoxedExpression, IComputeEngine } from './public';
import { asFloat, asRational, mul } from './numerics';
import { isRelationalOperator } from './utils';

export function applyCoefficient(
  value: number | Decimal | Complex | Rational | null,
  coef: Rational
): number | Decimal | Complex | Rational | null {
  if (isRationalOne(coef)) return value;
  if (isRationalZero(coef)) return 0;
  if (value === null) return null;
  if (isRationalNegativeOne(coef)) {
    if (typeof value === 'number') return -value;
    if (value instanceof Decimal) return value.neg();
    if (value instanceof Complex) return value.neg();
    return neg(value);
  }

  if (isRational(value)) return mul(value, coef);

  if (isBigRational(coef)) {
    const [n, d]: [bigint, bigint] = coef;
    if (typeof value === 'number') {
      if (Number.isInteger(value))
        return [BigInt(value) * n, BigInt(value) * d] as Rational;
      return new Decimal(value).mul(n.toString()).div(d.toString());
    }
    if (value instanceof Decimal) {
      const [nd, dd] = [new Decimal(n.toString()), new Decimal(d.toString())];
      if (value.isInteger()) {
        if (d === BigInt(1)) return value.mul(nd);
        return [BigInt(value.mul(nd).toString()), d] as Rational;
      }
      return value.mul(nd).div(dd);
    }
    if (value instanceof Complex) return value.mul(Number(n)).div(Number(d));
  } else {
    const [n, d] = coef;

    if (typeof value === 'number') {
      if (Number.isInteger(value)) return [value * n, d] as Rational;
      return (value * n) / d;
    }
    if (value instanceof Decimal) {
      if (value.isInteger())
        return [BigInt(value.mul(n).toString()), BigInt(d)] as Rational;
      return value.mul(n).div(d);
    }
    if (value instanceof Complex) return value.mul(n).div(d);
  }
  return null;
}

/** Combine rational expressions into a single fraction */
export function together(op: BoxedExpression): BoxedExpression {
  const ce = op.engine;
  const h = op.head;

  // Thread over inequality
  if (isRelationalOperator(h))
    return ce.function(h, [together(op.ops![0]), together(op.ops![1])]);

  if (h === 'Divide') return ce.div(op.ops![0], op.ops![1]);
  if (h === 'Add') {
    const [numer, denom] = op.ops!.reduce(
      (acc, x) => {
        if (x.head === 'Divide') {
          acc[0].push(x.ops![0]);
          acc[1].push(x.ops![1]);
        } else acc[0].push(x);
        return acc;
      },
      [[], []] as BoxedExpression[][]
    );
    return ce.div(ce.add(...numer), ce.add(...denom));
  }
  if (h === 'Negate') return ce.neg(together(op.ops![0]));
  return op;
}

/** Return an expression representing the common factors of `lhs` and `rhs`.
 */
function commonFactors(lhs: Factors, rhs: Factors): BoxedExpression {
  const factors: { factor: BoxedExpression; exponent: BoxedExpression }[] = [];
  const ce = lhs.engine;

  for (const x of lhs.factors) {
    const i = rhs.find(x.factor);
    if (i !== -1) {
      if (x.exponent.isSame(rhs.factors[i].exponent)) {
        // Account for non-numeric exponents, i.e. x^{n+1}
        factors.push(x);
      } else {
        const lhsExp = asFloat(x.exponent);
        const rhsExp = asFloat(rhs.factors[i].exponent);
        if (lhsExp !== null && rhsExp !== null) {
          if (lhsExp > 0 && rhsExp > 0) {
            const min = Math.min(lhsExp, rhsExp);
            factors.push({ factor: x.factor, exponent: ce.number(min) });
          } else if (lhsExp < 0 && rhsExp < 0) {
            const max = Math.max(lhsExp, rhsExp);
            factors.push({ factor: x.factor, exponent: ce.number(max) });
          }
        }
      }
    }
  }

  // Now check for numeric factors and see if there is a GCD to factor out
  let lhsNum = lhs.integerCoefficient();
  if (lhsNum !== null) {
    const rhsNum = rhs.integerCoefficient();
    if (rhsNum !== null) {
      factors.push({
        factor: ce.number(gcd(lhsNum, rhsNum)),
        exponent: ce.One,
      });
    }
  }

  if (factors.length === 0) return ce.One;

  return ce.mul(...factors.map((x) => ce.pow(x.factor, x.exponent)));
}

/**
 * Return a list of expressions that multiply together to form `expr`.
 */
export function factor(expr: BoxedExpression): BoxedExpression {
  const h = expr.head;
  if (isRelationalOperator(h)) {
    const lhs = new Factors(expr.op1);
    const rhs = new Factors(expr.op2);
    lhs.reduceExactNumbers();
    rhs.reduceExactNumbers();
    const common = commonFactors(lhs, rhs);
    if (!common.isOne) {
      lhs.div(common);
      rhs.div(common);
    }
    return expr.engine.function(h, [lhs.asExpression(), rhs.asExpression()]);
  }

  if (h === 'Add') {
    let common: Factors | null = null;
    for (const term of expr.ops!) {
      if (!common) {
        common = new Factors(term);
        common.reduceExactNumbers();
      } else {
        const rhs = new Factors(term);
        rhs.reduceExactNumbers();
        common = new Factors(commonFactors(common, rhs));
        common.reduceExactNumbers();
      }
    }

    return common?.asExpression() ?? expr.engine.One;
  }

  const factors = new Factors(together(expr));
  factors.reduceExactNumbers();
  return factors.asExpression();
}

class Factors {
  public factors: { factor: BoxedExpression; exponent: BoxedExpression }[] = [];

  hasNaN = false;
  hasZero = false;
  hasInfinity = false;
  sign = 1;

  engine: IComputeEngine;

  constructor(expr: BoxedExpression) {
    this.engine = expr.engine;
    this.mul(together(expr));
  }

  div(den: BoxedExpression) {
    if (den.isOne) return;
    if (den.isNegativeOne) {
      this.sign = -this.sign;
      return;
    }
    this.mul(den, this.engine.NegativeOne);
  }

  mul(factor: BoxedExpression, exponent?: BoxedExpression) {
    exponent ??= factor.engine.One;

    if (factor.head === 'Negate') {
      this.sign = -this.sign;
      factor = factor.ops![0];
    }
    if (factor.head === 'Divide') {
      this.mul(factor.ops![0], exponent);
      this.mul(factor.ops![1], this.engine.neg(exponent));
      return;
    }
    if (factor.head === 'Multiply') {
      for (const arg of factor.ops!) this.mul(arg, exponent);
      return;
    }
    if (factor.head === 'Power') {
      this.mul(factor.ops![0], this.engine.mul(factor.ops![1], exponent));
      return;
    }
    if (factor.head === 'Sqrt') {
      this.mul(factor.ops![0], this.engine.mul(this.engine.Half, exponent));
      return;
    }

    if (factor.isNegative) {
      this.sign = -this.sign;
      factor = this.engine.neg(factor);
    }

    if (exponent.isZero) return;
    if (factor.isOne) return;

    if (factor.isNaN) {
      this.hasNaN = true;
      return;
    }

    if (factor.isZero) {
      if (exponent.isNonNegative) this.hasZero = true;
      else this.hasNaN = true;
      return;
    }

    if (factor.isInfinity && exponent.isNonNegative) {
      if (exponent.isNonNegative) this.hasInfinity = true;
      else this.hasNaN = true;
      return;
    }

    const i = this.find(factor);
    if (i === -1) this.factors.push({ factor, exponent });
    else
      this.factors[i].exponent = this.engine.add(
        this.factors[i].exponent,
        exponent
      );
  }

  find(factor: BoxedExpression): number {
    return this.factors.findIndex((x) => x.factor.isSame(factor));
  }

  has(factor: BoxedExpression): boolean {
    return this.find(factor) !== -1;
  }

  reduceNumbers() {
    // Reduce all numeric factors to a single number
    const factors = this.factors;
    this.factors = [];

    const ce = this.engine;

    let num = ce.One;
    for (const factor of factors) {
      const v = factor.factor.N();
      if (v.numericValue !== null)
        num = ce.mul(num, ce.pow(v, factor.exponent));
      else this.factors.push(factor);
    }
    if (!num.isOne) this.factors.push({ factor: num, exponent: ce.One });
  }

  reduceExactNumbers() {
    const ce = this.engine;

    // Check if there is any numeric non-exact factor
    for (const factor of this.factors) {
      const x = factor.factor;
      if (x.numericValue !== null && !x.isExact) return this.reduceNumbers();
    }

    const factors = this.factors;
    this.factors = [];

    // Go over each factor and reduce the exact numeric ones:
    // integers, rationals, and square roots of rationals
    let rational: Rational = [1, 1];
    let im: number = 1; // Integer imaginary part (Gaussian Integers)
    let imCount = 0; // Number of imaginary parts
    let rationalSqrt: Rational = [1, 1];
    for (const factor of factors) {
      const exp = asFloat(factor.exponent);
      if (exp === null) {
        // A non-numeric exponent, so add it back to the list
        this.factors.push(factor);
        continue;
      }

      // Rational Square roots are converted to term+exponent when
      // added to the list. So check if the exponent is a square root
      // and the term a rational.
      if (Number.isInteger(2 * exp)) {
        const s = asRational(factor.factor);
        if (s) {
          rationalSqrt = mul(rationalSqrt, pow(s, 2 * exp));
          continue;
        }
      }
      const r = asRational(factor.factor);
      if (r) {
        rational = mul(rational, pow(r, exp));
        continue;
      }
      // Is this a Gaussian Integer?
      let c = factor.factor.numericValue;
      if (
        c !== null &&
        c instanceof Complex &&
        Number.isInteger(c.re) &&
        Number.isInteger(c.im) &&
        Number.isInteger(exp)
      ) {
        c = c.pow(exp);
        rational = mul(rational, [c.re, 1]);
        if (c.im !== 0) {
          im *= c.im;
          imCount += exp;
        }
        continue;
      }
      // This was not an exact number, so add it back to the list
      this.factors.push(factor);
    }

    let [factor, root] = reduceRationalSquareRoot(rationalSqrt);
    rational = mul(rational, factor);

    if (imCount !== 0) {
      if (imCount % 2 === 0) {
        rational = mul(rational, [im, 1]);
      } else {
        if (isRationalInteger(rational)) {
          this.factors.push({
            factor: ce.number(ce.complex(machineNumerator(rational), im)),
            exponent: ce.One,
          });
          rational = [1, 1];
        } else {
          this.factors.push({
            factor: ce.number(ce.complex(0, im)),
            exponent: ce.One,
          });
        }
      }
    }

    if (!isRationalOne(rational)) {
      this.factors.push({ factor: ce.number(rational), exponent: ce.One });
    }

    if (!isRationalOne(root)) {
      this.factors.push({ factor: ce.sqrt(ce.number(root)), exponent: ce.One });
    }
  }

  integerCoefficient(): number | null {
    let result: number | null = null;
    for (const x of this.factors) {
      const num = asFloat(x.factor);
      if (num !== null && Number.isInteger(num)) {
        const exp = asFloat(x.exponent);
        if (exp !== null) {
          result = (result ?? 1) * Math.pow(num, exp);
        }
        continue;
      }
    }
    return result;
  }

  asExpression(): BoxedExpression {
    const ce = this.engine;
    if (this.factors.length === 0) return ce.One;
    if (this.hasNaN) return ce.NaN;
    if (this.hasInfinity)
      return this.sign > 0 ? ce.PositiveInfinity : ce.NegativeInfinity;
    if (this.hasZero) return ce.Zero;

    if (this.factors.length === 1) {
      const { factor: term, exponent } = this.factors[0];
      return ce.pow(term, exponent);
    }

    let numeratorFactors = this.factors
      .filter((x) => x.exponent.isPositive && !x.factor.isOne)
      .map((x) => ce.pow(x.factor, x.exponent));

    let numerator: BoxedExpression;
    if (numeratorFactors.length === 0) {
      numerator = this.sign > 0 ? ce.One : ce.NegativeOne;
    } else if (numeratorFactors.length === 1) {
      if (this.sign < 0) numerator = ce.neg(numeratorFactors[0]);
      else numerator = numeratorFactors[0];
    } else {
      numerator = ce._fn('Multiply', numeratorFactors);
      if (this.sign < 0) numerator = ce.neg(numerator);
    }

    let denominator = this.factors
      .filter((x) => x.exponent.isNegative && !x.factor.isOne)
      .map((x) => ce.pow(x.factor, ce.neg(x.exponent)));

    if (denominator.length === 0) return numerator;
    if (denominator.length === 1) return ce.div(numerator, denominator[0]);
    return ce.div(numerator, ce._fn('Multiply', denominator));
  }
}
