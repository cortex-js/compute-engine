import Complex from 'complex.js';
import Decimal from 'decimal.js';
import { complexAllowed, bignumPreferred } from '../boxed-expression/utils';
import {
  asBignum,
  asFloat,
  asSmallInteger,
  factorPower,
} from '../numerics/numeric';
import { factorPower as bigFactorPower } from '../numerics/numeric-bignum';
import {
  asRational,
  inverse,
  isBigRational,
  isMachineRational,
  isRational,
  isRationalOne,
  isRationalZero,
  machineDenominator,
  machineNumerator,
  mul,
} from '../numerics/rationals';
import { BoxedExpression, IComputeEngine, Metadata, Rational } from '../public';
import { applyN } from '../symbolic/utils';

/**
 *
 * Return `null` if there is no canonicalization necessary and the result is
 * simply `ce._fn('Power', [base, exponent])`
 */
export function canonicalPower(
  ce: IComputeEngine,
  base: BoxedExpression,
  exponent: BoxedExpression,
  metadata?: Metadata
): BoxedExpression | null {
  if (exponent.symbol === 'ComplexInfinity') return ce._NAN;

  if (exponent.isLiteral) {
    if (exponent.isZero) return ce._ONE;

    if (base.isLiteral) {
      const smallBase = asFloat(base);

      //
      // Special cases
      //
      // Implement same results as sympy.
      // See https://docs.sympy.org/1.6/modules/core.html#pow
      //
      // if (base.isOne) return ce._ONE;
      if (smallBase === 1) return ce._ONE;
      // if (base.isZero) {
      if (smallBase === 0) {
        if (exponent.isPositive) return ce._ZERO;
        if (exponent.isNegative) return ce._COMPLEX_INFINITY; //  Unsigned Infinity...
      }

      if (exponent.isOne) return base;

      if (exponent.isNegativeOne) {
        //  x^(-1)

        // if (base.isOne) return ce._ONE;
        // if (base.isNegativeOne) return ce._NEGATIVE_ONE;
        if (smallBase === 1) return ce._ONE;
        if (smallBase === -1) return ce._NEGATIVE_ONE;
        if (base.isInfinity) return ce._ZERO;

        const r = base.numericValue;
        if (r !== null) {
          if (typeof r === 'number' && Number.isInteger(r))
            return ce.number([1, r], { metadata });
          if (r instanceof Decimal && r.isInteger())
            return ce.number([ce._BIGNUM_ONE, r], { metadata });
          if (isRational(r)) return ce.number(inverse(r), { metadata });
        }
        return ce._fn('Power', [base, ce._NEGATIVE_ONE], metadata);
      }

      // x^{0.5}, x^{1/2} -> Square Root
      const e = asFloat(exponent);
      if (e === 0.5 || e === -0.5) {
        const b = asSmallInteger(base);
        if (b !== null && b > 0) {
          // Factor out small integers
          // √(12) -> 2√3
          const [coef, radicand] = factorPower(b, 2);

          if (radicand === 1 && coef === 1) return ce._ONE;
          if (coef !== 1) {
            if (radicand === 1) return ce.number(e >= 0 ? coef : [1, coef]);
            return ce.mul([
              ce.number(coef),
              ce.power(ce.number(radicand), ce._HALF),
            ]);
          }
        }

        if (e > 0) return ce._fn('Power', [base, ce._HALF], metadata);
        return ce._fn('Power', [base, ce.number([-1, 2])], metadata);
      }

      if (base.isInfinity) {
        if (exponent.numericValue instanceof Complex) {
          const re = exponent.numericValue.re;
          if (re === 0) return ce._NAN;
          if (re < 0) return ce._ZERO;
          if (re > 0) return ce._COMPLEX_INFINITY;
        }
        if (base.isNegative) {
          // base = -∞
          if (exponent.isInfinity) return ce._NAN;
        } else if (base.isPositive) {
          // base = +∞
          if (exponent.isNegativeOne) return ce._ZERO;
          if (exponent.isInfinity)
            return exponent.isNegative ? ce._ZERO : ce._POSITIVE_INFINITY;
        }
      }

      if (exponent.isInfinity && (base.isOne || base.isNegativeOne))
        return ce._NAN;

      const r = asRational(base);
      if (r) {
        const e = asSmallInteger(exponent);
        if (e !== null) {
          if (e === -1) return ce.number(inverse(r));
          // if (e > 0) return ce.number([Math.pow(n, e), Math.pow(d, e)]);
          // return ce.number([Math.pow(d, -e), Math.pow(n, -e)]);
        }

        // @todo: could call factorPower to handle \sqrt and \sqrt[3]
      }
    }
  }

  //
  // Power rule
  //
  if (base.head === 'Power' && base.op1.isReal) {
    const a = asSmallInteger(exponent);
    if (a !== null) {
      const b = asSmallInteger(base.op2);
      if (b !== null) {
        return ce.power(base.op1, ce.number(a * b));
      }
    }
    if (base.op1.isNonNegative) {
      const ar = asRational(exponent);
      if (ar) {
        const br = asRational(base.op2);
        if (br) return ce.power(base.op1, ce.number(mul(ar, br)));
      }
    }
  }

  // Distribute over multiplication
  // (abc)^n -> a^n b^n c^n
  if (base.head === 'Multiply') {
    const e = asSmallInteger(exponent);
    if (e !== null) return ce.mul(base.ops!.map((x) => ce.power(x, exponent)));
  }

  return null;
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
  if (isBigRational(num)) return ce.number([num[1].pow(2), num[0].pow(2)]);

  if (base.head === 'Multiply')
    return ce.mul(base.ops!.map((x) => square(ce, x)));

  if (base.head === 'Power') {
    const exp = asSmallInteger(base.op2);
    if (exp !== null) return ce.power(base.op1, ce.number(exp * 2));
    return ce.power(base.op1, ce.mul([ce.number(2), base.op2]));
  }

  return ce.power(base, ce.number(2));
}

export function processPower(
  ce: IComputeEngine,
  base: BoxedExpression,
  exponent: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  if (base.head === 'Multiply') {
    let c: Rational = bignumPreferred(ce)
      ? [ce._BIGNUM_ONE, ce._BIGNUM_ONE]
      : [1, 1];
    const xs: BoxedExpression[] = [];
    for (const op of base.ops!) {
      const r = asRational(op);
      if (r) c = mul(c, r);
      else xs.push(op);
    }

    if (!isRationalOne(c))
      return ce.mul([
        processSqrt(ce, ce.number(c), mode) ?? ce._ONE,
        ce.power(
          processPower(ce, ce.mul(xs), exponent, mode) ?? ce.mul(xs),
          exponent
        ),
      ]);
  }

  if (base.head === 'Power') {
    // a^-1^-1 -> a
    if (asSmallInteger(base.op2) === -1 && asSmallInteger(exponent) === -1)
      return base.op1;

    const e1 = asRational(base.op2);
    const e2 = asRational(exponent);
    if (e1 && e2) {
      const e = mul(e1, e2);
      if (isRationalZero(e)) return ce._ONE;
      if (isRationalOne(e)) return base.op1;
      return ce.power(base.op1, e);
    }
    if (mode === 'N') {
      const ef1 = asFloat(base.op2);
      const ef2 = asFloat(exponent);
      if (ef1 !== null && ef2 !== null) {
        const ef = ef1 * ef2;
        if (ef === 0) return ce._ONE;
        if (ef === 1) return base.op1;
        return ce.power(base.op1, ef);
      }
    }
  }

  //
  // Handle some specific cases: square root and cube root, where
  // we factor out the common factors
  //
  if (base.isLiteral && base.isInteger) {
    const r = asRational(exponent);
    if (r) {
      const [n, d] = [machineNumerator(r), machineDenominator(r)];
      if ((n === 1 || n === -1) && (d === 2 || d === 3)) {
        if (bignumPreferred(ce) || base.numericValue instanceof Decimal) {
          const bigBase = asBignum(base)!;
          const [factor, root] = bigFactorPower(ce, bigBase, d);

          if (root.eq(1) && factor.eq(1)) return ce._ONE;
          if (factor.eq(1)) return undefined;
          if (root.eq(1))
            return ce.number(n >= 0 ? factor : [ce.bignum(1), factor]);

          return ce.mul([
            ce.number(factor),
            ce.power(ce.number(root), exponent),
          ]);
        }
        //  @todo: handle rationalValue
        // @todo:handle base.machineValue < 0
        if (typeof base.numericValue === 'number') {
          const [factor, root] = factorPower(base.numericValue, d);

          if (root === 1 && factor === 1) return ce._ONE;
          if (factor === 1) return undefined;
          if (root === 1) return ce.number(n >= 0 ? factor : [1, factor]);

          return ce.mul([
            ce.number(factor),
            ce.power(ce.number(root), exponent),
          ]);
        }
      }
    }
  }

  if (mode !== 'simplify' && base.isLiteral && exponent.isLiteral) {
    if (base.numericValue instanceof Complex) {
      if (exponent.numericValue instanceof Complex)
        return ce.number(base.numericValue.pow(exponent.numericValue));
      return ce.number(base.numericValue.pow(asFloat(exponent) ?? NaN));
    }

    if (exponent.numericValue instanceof Complex) {
      const b = asFloat(base) ?? null;
      if (b !== null)
        return ce.number(ce.complex(b).pow(exponent.numericValue));
    }

    if (
      bignumPreferred(ce) ||
      base.numericValue instanceof Decimal ||
      exponent.numericValue instanceof Decimal
    ) {
      const bigBase = asBignum(base);
      const bigExp = asBignum(exponent);
      if (!bigBase || !bigExp) return ce._NAN;

      if (bigExp.isNeg()) {
        const br = bigBase.pow(bigExp.neg());
        if (br.isInteger()) return ce.number([ce._BIGNUM_ONE, br]);
        return ce.number(bigBase.pow(bigExp));
      }

      return ce.number(bigBase.pow(bigExp));
    }

    const ef = asFloat(exponent) ?? NaN;
    if (ef < 0) {
      const bf = asFloat(base) ?? NaN;
      const rf = Math.pow(bf, -ef);
      if (Number.isInteger(rf)) return ce.number([1, rf]);
      return ce.number(Math.pow(bf, ef));
    }
    return ce.number(Math.pow(asFloat(base) ?? NaN, ef));
  }

  return undefined;
}

export function processSqrt(
  ce: IComputeEngine,
  base: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  if (base.isOne) return ce._ONE;
  if (base.isZero) return ce._ZERO;
  if (base.isNegativeOne) return complexAllowed(ce) ? ce._I : ce._NAN;

  const r = asRational(base);

  if (mode === 'N' || (mode === 'evaluate' && !r))
    return applyN(
      base,
      (x) => (x < 0 ? ce.complex(x).sqrt() : Math.sqrt(x)),
      (x) => (x.isNeg() ? ce.complex(x.toNumber()).sqrt() : x.sqrt()),
      (x) => x.sqrt()
    );

  const n = asSmallInteger(base);
  if (n !== null) {
    if (n < 0 && !complexAllowed(ce)) return ce._NAN;

    const [factor, root] = factorPower(Math.abs(n), 2);
    if (n < 0) {
      if (root === 1) ce.mul([ce.number(ce.complex(0, factor))]);
      return ce.mul([
        ce.number(ce.complex(0, factor)),
        ce.sqrt(ce.number(root)),
      ]);
    }
    if (root === 1) return ce.number(factor);
    return ce.mul([ce.number(factor), ce.sqrt(ce.number(root))]);
  }

  if (r) {
    if (isMachineRational(r) && !bignumPreferred(ce)) {
      const [n, d] = r;
      if (
        Math.abs(n) < Number.MAX_SAFE_INTEGER &&
        d < Number.MAX_SAFE_INTEGER
      ) {
        const [nFactor, nRoot] = factorPower(Math.abs(n), 2);
        const [dFactor, dRoot] = factorPower(d, 2);
        if (n < 0)
          return !complexAllowed(ce)
            ? ce._NAN
            : ce.mul([
                ce.number([nFactor, dFactor]),
                ce.sqrt(ce.number([nRoot, dRoot])),
                ce._I,
              ]);

        return ce.mul([
          ce.number([nFactor, dFactor]),
          ce.sqrt(ce.number([nRoot, dRoot])),
        ]);
      }
    }
    if (isBigRational(r) || bignumPreferred(ce)) {
      const n = ce.bignum(r[0]);
      const [nFactor, nRoot] = bigFactorPower(ce, n.abs(), 2);
      const [dFactor, dRoot] = bigFactorPower(ce, ce.bignum(r[1]), 2);

      if (n.isNeg())
        return !complexAllowed(ce)
          ? ce._NAN
          : ce.mul([
              ce.number([nFactor, dFactor]),
              ce.sqrt(ce.number([nRoot, dRoot])),
              ce._I,
            ]);

      return ce.mul([
        ce.number([nFactor, dFactor]),
        ce.sqrt(ce.number([nRoot, dRoot])),
      ]);
    }
  }

  return undefined;
}
