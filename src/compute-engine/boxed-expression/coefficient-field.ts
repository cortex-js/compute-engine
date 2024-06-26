/**
 *
 * ## THEORY OF OPERATIONS
 *
 * In order to preserve exact results, some numeric operations are performed
 * on "coefficients" which represent a product of a rational number,
 * an algebraic numbers and the square root of an integer.
 *
 * A field is defined on these coefficients.
 *
 *
 */

import Complex from 'complex.js';
import {
  Rational,
  inverse,
  isNeg,
  isRational,
  isRationalOne,
  isRationalZero,
  neg,
  pow,
  rationalize,
} from '../numerics/rationals';
import { factor } from './factor.js';
import { add, asMachineInteger, asRational, div, mul } from './numerics';
import { BoxedExpression } from './public';

// A coefficient is the product of a float, a rational and a square root
// of an integer.
export interface CoefficientData {
  float: number;
  rational: Rational;
  sqrt: number;
}

export class Coefficient implements CoefficientData {
  static zero = new Coefficient(0);
  static one = new Coefficient(1);

  /**
   * Attempt to factor a numeric coefficient `c` and a `rest` out of a
   * canonical expression `expr` such that `ce.mul(c, rest)` is equal to `expr`.
   *
   * Attempts to make `rest` a positive value (i.e. pulls out negative sign).
   *
   * For example:
   *
   * ['Multiply', 2, 'x', 3, 'a']
   *    -> [6, ['Multiply', 'x', 'a']]
   *
   * ['Divide', ['Multiply', 2, 'x'], ['Multiply', 3, 'y', 'a']]
   *    -> [['Rational', 2, 3], ['Divide', 'x', ['Multiply, 'y', 'a']]]
   */

  static fromExpression(
    expr: BoxedExpression
  ): [coef: Coefficient, rest: BoxedExpression] {
    console.assert(expr.isCanonical);
    const ce = expr.engine;

    //
    // Add
    //
    //  use factor() to factor out common factors
    if (expr.head === 'Add') expr = factor(expr);

    //
    // Multiply
    //
    if (expr.head === 'Multiply') {
      const rest: BoxedExpression[] = [];
      let coef = Coefficient.one;
      for (const arg of expr.ops!) {
        const [c, r] = Coefficient.fromExpression(arg);
        coef = coef.mul(c);
        if (!r.isOne) rest.push(r);
      }

      return [coef, ce.mul(...rest)];
    }

    //
    // Divide
    //
    if (expr.head === 'Divide') {
      const [coef1, numer] = Coefficient.fromExpression(expr.op1);
      const [coef2, denom] = Coefficient.fromExpression(expr.op2);

      return [coef1.div(coef2), ce.div(numer, denom)];
    }

    //
    // Power
    //
    if (expr.head === 'Power') {
      // We can only extract a coef if the exponent is a literal
      if (expr.op2.numericValue === null) return [Coefficient.one, expr];

      // eslint-disable-next-line prefer-const
      let [coef, base] = Coefficient.fromExpression(expr.op1);
      if (coef.isOne) return [coef, expr];

      const exponent = asMachineInteger(expr.op2);
      if (exponent !== null)
        return [coef.pow(exponent), ce.pow(base, expr.op2)];

      return [Coefficient.one, expr];
    }

    console.assert(expr.head !== 'Root');
    console.assert(expr.head !== 'Sqrt');
    // if (expr.head === 'Sqrt') {
    //   const [coef, rest] = Coefficient.fromExpression(expr.op1);
    //   let sqrtCoef = sqrt(coef);
    //   return sqrtCoef ? [sqrtCoef, ce.sqrt(rest)] : [[1, 1], expr];
    // }

    //
    // Negate
    //
    if (expr.head === 'Negate') {
      const [coef, rest] = Coefficient.fromExpression(expr.op1);
      return [coef.neg(), rest];
    }

    // @todo:  could consider others.. `Ln`, `Abs`, trig functions

    //
    // Literal
    //

    // Make the part positive if the real part is negative
    const v = expr.numericValue;
    if (typeof v === 'number') return [new Coefficient(v), ce.One];
    if (isRational(v)) return [new Coefficient({ rational: v }), ce.One];
    if (v instanceof Complex && v.re < 0)
      return [Coefficient.one.neg(), ce.number(ce.complex(-v.re, -v.im))];

    const r = asRational(expr);
    return r
      ? [new Coefficient({ rational: r }), ce.One]
      : [Coefficient.one, expr];
  }

  float: number;
  rational: Rational;
  sqrt: number;

  constructor(value: number | Partial<CoefficientData> = 1) {
    if (typeof value === 'number') {
      this.float = value;
      this.rational = [1, 1];
      this.sqrt = 1;
    } else if (isRational(value)) {
      this.float = 1;
      this.rational = value;
      this.sqrt = 1;
    } else {
      if ('float' in value && value.float !== undefined)
        this.float = value.float;
      else this.float = 1;
      if ('rational' in value && value.rational !== undefined)
        this.rational = value.rational;
      else this.rational = [1, 1];
      if ('sqrt' in value && value.sqrt !== undefined) this.sqrt = value.sqrt;
      else this.sqrt = 1;
    }
    this.normalize();
  }
  asFloat(): number {
    return (
      (this.float * Math.sqrt(this.sqrt) * Number(this.rational[0])) /
      Number(this.rational[1])
    );
  }
  asRational(): Rational {
    let result = rationalize(this.asFloat());

    if (typeof result === 'number') return [result, 1];
    return result;
  }

  normalize(): void {
    // Note: the order of the operations is significant

    if (this.sqrt === 0 || isRationalZero(this.rational)) {
      this.float = 0;
      this.rational = [0, 1];
      this.sqrt = 0;
      return;
    }

    // 1/ If sqrt is not an integer, convert to float
    if (!Number.isInteger(this.sqrt)) {
      this.float *= Math.sqrt(this.sqrt);
      this.sqrt = 1;
    }

    // 2/ If sqrt is an exact square, convert to rational
    const sqrt = Math.sqrt(this.sqrt);
    if (Number.isInteger(sqrt)) {
      this.rational = mul(this.rational, [sqrt, 1]);
      this.sqrt = 1;
    }

    // 3/ Attempt to convert float to a rational with a denominator of 10 or less
    const r = rationalize(this.float);
    if (isRational(r) && r[1] <= 10) {
      this.rational = mul(this.rational, r);
      this.float = 1;
    }

    // 4/ If float is not an integer, convert all to float
    if (!Number.isInteger(this.float)) {
      this.float = this.asFloat();
      this.sqrt = 1;
      this.rational = [1, 1];
    }

    // 5/ If float *is* an integer, convert to rational
    if (Number.isInteger(this.float)) {
      this.rational = mul(this.rational, [this.float, 1]);
      this.float = 1;
    }

    // 6/ Carry the sign on the float
    if (isNeg(this.rational)) {
      this.rational = neg(this.rational);
      this.float = -this.float;
    }
  }

  get isZero(): boolean {
    return this.float === 0;
  }
  get isOne(): boolean {
    return this.float === 1 && this.sqrt === 1 && isRationalOne(this.rational);
  }

  get sign(): number {
    return Math.sign(this.float);
  }

  neg(): Coefficient {
    return new Coefficient({
      float: -this.float,
      rational: this.rational,
      sqrt: this.sqrt,
    });
  }

  inv(): Coefficient {
    return new Coefficient({
      float: 1 / this.float,
      rational: inverse(this.rational),
      sqrt: 1 / this.sqrt,
    });
  }

  mul(other: Partial<CoefficientData> | number | Rational): Coefficient {
    if (typeof other === 'number') other = { float: other };
    else if (isRational(other)) other = { rational: other };

    return new Coefficient({
      float: this.float * (other.float ?? 1),
      rational: mul(this.rational, other.rational ?? [1, 1]),
      sqrt: this.sqrt * (other.sqrt ?? 1),
    });
  }

  pow(exponent: number): Coefficient {
    console.assert(Number.isInteger(exponent));
    return new Coefficient({
      float: Math.pow(this.float, exponent),
      rational: pow(this.rational, exponent),
      sqrt: this.sqrt ** exponent,
    });
  }

  div(other: Partial<CoefficientData> | number | Rational): Coefficient {
    if (typeof other === 'number') other = { float: other };
    else if (isRational(other)) other = { rational: other };

    return new Coefficient({
      float: this.float / (other.float ?? 1),
      rational: div(this.rational, other.rational ?? [1, 1]),
      sqrt: this.sqrt / (other.sqrt ?? 1),
    });
  }

  add(other: Partial<CoefficientData> | number | Rational): Coefficient {
    if (typeof other === 'number') other = { float: other };
    else if (isRational(other)) other = { rational: other };

    // Can we keep a rational result?
    if (
      Math.abs(this.float) === 1 &&
      Math.abs(other.float ?? 1) === 1 &&
      this.sqrt === 1 &&
      (other.sqrt ?? 1) === 1 &&
      other.rational
    ) {
      return new Coefficient({
        // Preserve the sign of the float
        float: this.float * (other.float ?? 1),
        rational: add(this.rational, other.rational),
      });
    }

    return new Coefficient(this.asFloat() + new Coefficient(other).asFloat());
  }

  sub(other: Partial<CoefficientData> | number | Rational): Coefficient {
    if (typeof other === 'number') other = { float: other };
    else if (isRational(other)) other = { rational: other };
    if (
      Math.abs(this.float) === 1 &&
      Math.abs(other.float ?? 1) === 1 &&
      this.sqrt === 1 &&
      (other.sqrt ?? 1) === 1 &&
      other.rational
    ) {
      return new Coefficient({
        float: this.float * (other.float ?? 1),
        rational: add(this.rational, neg(other.rational)),
      });
    }

    return new Coefficient(this.asFloat() - new Coefficient(other).asFloat());
  }

  eq(other: Coefficient): boolean {
    return (
      this.float === other.float &&
      this.sqrt === other.sqrt &&
      this.rational[0] === other.rational[0] &&
      this.rational[1] === other.rational[1]
    );
  }
}
