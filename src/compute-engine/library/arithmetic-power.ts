import Complex from 'complex.js';
import { Decimal } from 'decimal.js';
import {
  complexAllowed,
  bignumPreferred,
  asBigint,
} from '../boxed-expression/utils';
import { factorPower } from '../numerics/numeric';
import {
  bigint,
  factorPower as bigFactorPower,
} from '../numerics/numeric-bigint';
import {
  Rational,
  isBigRational,
  isMachineRational,
  isRational,
  isOne,
  machineDenominator,
  machineNumerator,
} from '../numerics/rationals';
import { BoxedExpression, IComputeEngine, Metadata } from '../public';
import { applyN } from '../symbolic/utils';
import {
  asFloat,
  asRational,
  asMachineInteger,
  mul,
  asBignum,
} from '../boxed-expression/numerics';

/**
 *
 */
export function canonicalPower(
  base: BoxedExpression,
  exponent: BoxedExpression,
  metadata?: Metadata
): BoxedExpression {
  const ce = base.engine;
  if (exponent.symbol === 'ComplexInfinity') return ce.NaN;

  if (exponent.isZero) return ce.One;

  if (exponent.isOne) return base;

  if (exponent.isNegativeOne) return ce.inv(base);

  if (exponent.numericValue !== null && base.numericValue !== null) {
    //
    // Special cases
    //
    // Implement same results as sympy.
    // See https://docs.sympy.org/1.6/modules/core.html#pow
    //
    if (base.isOne) return ce.One;
    if (base.isZero) {
      if (exponent.isPositive) return ce.Zero;
      if (exponent.isNegative) return ce.ComplexInfinity; //  Unsigned Infinity...
    }

    //  x^(-1)
    if (exponent.isNegativeOne) return ce.inv(base);

    // x^{0.5}, x^{1/2} -> Square Root
    const e = asFloat(exponent);
    if (e === 0.5 || e === -0.5) {
      // Preserve square root of rationals as sqrt
      const r = asRational(base);
      if (r) {
        const result = ce._fn('Sqrt', [base], metadata);
        if (e > 0) return result;
        return ce._fn('Divide', [ce.One, result], metadata);
      }
      return ce._fn('Power', [base, exponent], metadata);
    }

    if (base.isInfinity) {
      if (exponent.numericValue instanceof Complex) {
        const re = exponent.numericValue.re;
        if (re === 0) return ce.NaN;
        if (re < 0) return ce.Zero;
        if (re > 0) return ce.ComplexInfinity;
      }
      if (base.isNegative) {
        // base = -∞
        if (exponent.isInfinity) return ce.NaN;
      } else if (base.isPositive) {
        // base = +∞
        if (exponent.isNegativeOne) return ce.Zero;
        if (exponent.isInfinity)
          return exponent.isNegative ? ce.Zero : ce.PositiveInfinity;
      }
    }

    if (exponent.isInfinity && (base.isOne || base.isNegativeOne))
      return ce.NaN;
  }

  //
  // Power rule
  //

  // a^b^c -> a^(b*c)
  if (base.head === 'Power' && base.op1.isReal) {
    const a = asMachineInteger(exponent);
    if (a !== null) {
      const b = asMachineInteger(base.op2);
      if (b !== null) return ce.pow(base.op1, ce.number(a * b));
    }
    if (base.op1.isNonNegative) {
      const ar = asRational(exponent);
      if (ar) {
        const br = asRational(base.op2);
        if (br) return ce.pow(base.op1, ce.number(mul(ar, br)));
      }
    }
  }
  if (base.head === 'Power')
    return ce._fn(
      'Power',
      [base.op1, ce.evalMul(base.op2, exponent)],
      metadata
    );

  return ce._fn('Power', [base, exponent], metadata);
}

export function square(
  ce: IComputeEngine,
  base: BoxedExpression
): BoxedExpression {
  const num = base.numericValue;
  if (typeof num === 'number') return ce.number(num * num);
  if (num instanceof Decimal) return ce.number(num.pow(2));
  if (num instanceof Complex) return ce.number(num.pow(2));
  if (isMachineRational(num))
    return ce.number([num[1] * num[1], num[0] * num[0]]);
  if (isBigRational(num)) return ce.number([num[1] * num[1], num[0] * num[0]]);

  if (base.head === 'Multiply')
    return ce._fn(
      'Multiply',
      base.ops!.map((x) => square(ce, x))
    ); // Don't call ce.mul() to avoid infinite loops

  if (base.head === 'Power') {
    const exp = asMachineInteger(base.op2);
    if (exp !== null) return ce.pow(base.op1, ce.number(exp * 2));
    return ce.pow(base.op1, ce.evalMul(ce.number(2), base.op2));
  }

  return ce.pow(base, ce.number(2));
}

function numEvalPower(
  ce: IComputeEngine,
  base: BoxedExpression,
  exponent: BoxedExpression
): BoxedExpression | undefined {
  if (base.numericValue === null || exponent.numericValue === null)
    return undefined;

  //
  // Complex base or exponent
  //
  if (base.numericValue instanceof Complex) {
    if (exponent.numericValue instanceof Complex)
      return ce.number(base.numericValue.pow(exponent.numericValue));
    return ce.number(base.numericValue.pow(asFloat(exponent) ?? NaN));
  }

  if (exponent.numericValue instanceof Complex) {
    const b = asFloat(base) ?? null;
    if (b !== null) return ce.number(ce.complex(b).pow(exponent.numericValue));
    return undefined;
  }

  //
  // Bignum
  //
  const invExp = rootExp(exponent);
  if (
    bignumPreferred(ce) ||
    base.numericValue instanceof Decimal ||
    exponent.numericValue instanceof Decimal
  ) {
    const bigBase = asBignum(base);
    const bigExp = asBignum(exponent);
    if (!bigBase || !bigExp) return undefined;
    if (invExp === 2) {
      if (bigBase.isNeg())
        return complexAllowed(ce)
          ? ce.number(ce.complex(0, bigBase.neg().sqrt().toNumber()))
          : ce.NaN;
      return ce.number(bigBase.sqrt());
    }
    if (!bigExp.isInteger() && bigBase.isNeg()) {
      // Complex, if allowed
      if (!complexAllowed(ce)) return ce.NaN;
      const zBase = ce.complex(bigBase.toNumber());
      const zExp = ce.complex(bigExp.toNumber());
      return ce.number(zBase.pow(zExp));
    }
    return ce.number(bigBase.pow(bigExp));
  }

  //
  // Machine
  //
  const floatExp = asFloat(exponent) ?? NaN;
  const floatBase = asFloat(base) ?? NaN;
  if (invExp === 2) {
    if (floatBase < 0) {
      return complexAllowed(ce)
        ? ce.evalMul(ce.I, ce.number(Math.sqrt(-floatBase)))
        : ce.NaN;
    }
    return ce.number(Math.sqrt(floatBase));
  }
  if (!Number.isInteger(floatExp) && floatBase < 0) {
    if (!complexAllowed(ce)) return ce.NaN;
    const zBase = ce.complex(floatBase);
    const zExp = ce.complex(floatExp);
    return ce.number(zBase.pow(zExp));
  }
  return ce.number(Math.pow(floatBase, floatExp));
}

export function processPower(
  ce: IComputeEngine,
  base: BoxedExpression,
  exponent: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  //
  // Handle complex numbers (exp^{ci}})
  //
  if (
    mode !== 'simplify' &&
    base.symbol === 'ExponentialE' &&
    exponent instanceof Complex
  ) {
    const im = exponent.im;
    const re = exponent.re;
    let result: BoxedExpression;
    if (re === 0)
      result = this.number(this.complex(Math.cos(im), Math.sin(im)));
    else if (im === 0) return this.number(Math.exp(re));
    else {
      const e = Math.exp(re);
      result = this.number(this.complex(e * Math.cos(im), e * Math.sin(im)));
    }
    if (mode === 'N') return result.N();
    return result;
  }

  if (base.head === 'Divide') {
    return ce.function('Divide', [
      processPower(ce, base.op1, exponent, mode) ??
        ce._fn('Power', [base.op1, exponent]),
      processPower(ce, base.op2, exponent, mode) ??
        ce._fn('Power', [base.op2, exponent]),
    ]);
  }

  if (base.head === 'Multiply') {
    let c: Rational = bignumPreferred(ce) ? [BigInt(1), BigInt(1)] : [1, 1];
    let sqrt = c;
    const xs: BoxedExpression[] = [];
    for (const op of base.ops!) {
      const r = asRational(op);
      if (r) c = mul(c, r);
      else {
        const s = asRationalSqrt(op);
        if (s) sqrt = mul(sqrt, s);
        else xs.push(op);
      }
    }

    if (!isOne(c) || !isOne(sqrt)) {
      const a1 = processPower(ce, ce.number(c), exponent, mode);
      const a2 = processPower(
        ce,
        ce.number(sqrt),
        ce.div(exponent, ce.number(2)),
        mode
      );
      const xsprod = ce.evalMul(...xs);
      const a3 =
        processPower(ce, xsprod, exponent, mode) ??
        ce._fn('Power', [xsprod, exponent]);
      if (a1 && a2 && a3) return ce.evalMul(a1, a2, a3);
    }
  }

  if (base.head === 'Power') {
    // a^-1^-1 -> a
    if (asMachineInteger(base.op2) === -1 && asMachineInteger(exponent) === -1)
      return base.op1;

    const e1 = asRational(base.op2);
    const e2 = asRational(exponent);
    if (e1 && e2) {
      const e = mul(e1, e2);
      return ce.pow(base.op1, e);
    }
    if (mode === 'N') {
      const ef1 = asFloat(base.op2);
      const ef2 = asFloat(exponent);
      if (ef1 !== null && ef2 !== null) {
        const ef = ef1 * ef2;
        if (ef === 0) return ce.One;
        if (ef === 1) return base.op1;
        return ce.pow(base.op1, ef);
      }
    }
  }

  //
  // If square root or cube root, attempt to factor out the perfect
  // factors: sqrt(75) -> 5^2 * 3
  //
  if (mode !== 'N' && base.numericValue !== null && base.isInteger) {
    if (base.isOne) return ce.One;
    const smallExpr = asMachineInteger(exponent);
    if (smallExpr) return numEvalPower(ce, base, exponent);

    const r = asRational(exponent);
    if (r) {
      const [n, d] = [machineNumerator(r), machineDenominator(r)];
      if ((n === 1 || n === -1) && (d % 2 === 0 || d === 3)) {
        if (bignumPreferred(ce) || base.numericValue instanceof Decimal) {
          const bigBase = asBigint(base)!;
          if (d % 2 === 0 && bigBase < 0 && !complexAllowed(ce)) return ce.NaN;

          const sign =
            bigBase < 0 ? (d % 2 === 0 ? ce.I : ce.NegativeOne) : ce.One;

          const [factor, root] = bigFactorPower(
            bigBase > 0 ? bigBase : -bigBase,
            d
          );

          if (root === BigInt(1) && factor === BigInt(1)) return sign;

          // If factor === 1, nothing special to do, fall through
          if (factor !== BigInt(1)) {
            if (root === BigInt(1))
              return ce.evalMul(
                sign,
                ce.number(n >= 0 ? factor : [BigInt(1), factor])
              );

            return ce.evalMul(
              sign,
              ce.number(factor),
              ce.pow(ce.number(root), exponent)
            );
          }
        } else if (typeof base.numericValue === 'number') {
          // Square root of a negative number, and no complex allowed
          if (base.numericValue < 0 && d % 2 === 0 && !complexAllowed(ce))
            return ce.NaN;

          const [factor, root] = factorPower(Math.abs(base.numericValue), d);

          const sign =
            base.numericValue < 0
              ? d % 2 === 0
                ? ce.I
                : ce.NegativeOne
              : ce.One;

          if (root === 1 && factor === 1) return sign;
          if (factor !== 1) {
            if (root === 1)
              return ce.evalMul(sign, ce.number(n >= 0 ? factor : [1, factor]));

            return ce.evalMul(
              sign,
              ce.number(factor),
              ce.pow(ce.number(root), exponent)
            );
          }
        } else {
          //  @todo: handlebase  rationalValue
        }
      }
      if (base.isNegative) {
        if (!complexAllowed) return ce.NaN;
        return ce.evalMul(ce.I, ce.box(['Sqrt', base.neg()]));
      }
      return undefined;
    }
  }

  if (mode !== 'N' && isRational(base.numericValue)) {
    const [n, d] = base.numericValue;
    return ce.div(
      ce.pow(ce.number(n), exponent),
      ce.pow(ce.number(d), exponent)
    );
  }

  if (
    mode !== 'simplify' &&
    base.numericValue !== null &&
    exponent.numericValue !== null
  )
    return numEvalPower(ce, base, exponent);

  return undefined;
}

/** Return the inverse of `exponent`.
 * Used to check if a power is a square root or cube root.
 */
function rootExp(exponent: BoxedExpression): number | null {
  if (typeof exponent.numericValue === 'number') {
    const inv = 1 / exponent.numericValue;
    if (Number.isInteger(inv)) return inv;
    return null;
  }
  if (exponent.numericValue instanceof Decimal) {
    const inv = exponent.engine._BIGNUM_ONE.div(exponent.numericValue);
    if (inv.isInt()) return inv.toNumber();
    return null;
  }

  if (!isRational(exponent.numericValue)) return null;
  const [n, d] = [
    machineNumerator(exponent.numericValue),
    machineDenominator(exponent.numericValue),
  ];
  if (n !== 1 && n !== -1) return null;
  return n * d;
}

export function isSqrt(expr: BoxedExpression): boolean {
  return (
    expr.head === 'Sqrt' || (expr.head === 'Power' && asFloat(expr.op2) === 0.5)
  );
}

export function asRationalSqrt(expr: BoxedExpression): Rational | null {
  if (!isSqrt(expr)) return null;
  return asRational(expr.op1) ?? null;
}
