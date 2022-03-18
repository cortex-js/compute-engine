import { useDecimal } from '../boxed-expression/utils';
import { factorPower } from '../numerics/numeric';
import { BoxedExpression, IComputeEngine, Metadata } from '../public';

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
  if (exponent.symbol === 'ComplexInfinity') return ce.NAN;

  if (exponent.isLiteral) {
    if (exponent.isZero) return ce.ONE;

    if (base.isLiteral) {
      //
      // Special cases
      //
      // Implement same results as sympy.
      // See https://docs.sympy.org/1.6/modules/core.html#pow
      //
      if (base.isOne) return ce.ONE;
      if (base.isZero) {
        if (exponent.isPositive) return ce.ZERO;
        if (exponent.isNegative) return ce.COMPLEX_INFINITY; //  Unsigned Infinity...
      }

      if (exponent.isOne) return base;

      if (exponent.isNegativeOne) {
        if (base.isOne) return ce.ONE;
        if (base.isNegativeOne) return ce.NEGATIVE_ONE;
        if (base.isInfinity) return ce.ZERO;
        const [n, d] = base.rationalValue;
        if (n !== null && d !== null) return ce.number([d, n], metadata);
        const i = base.asFloat;
        if (i !== null && Number.isInteger(i))
          return ce.number([1, i], metadata);
        return ce._fn('Power', [base, ce.NEGATIVE_ONE], metadata);
      }

      // x^{0.5}, x^{1/2} -> Square Root
      const e = exponent.asFloat;
      if (e === 0.5 || e === -0.5) {
        const b = base.asSmallInteger;
        if (b !== null && b > 0) {
          // Factor out small integers
          // √(12) -> 2√3
          const [coef, radicand] = factorPower(b, 2);

          if (radicand === 1 && coef === 1) return ce.ONE;
          if (coef !== 1) {
            if (radicand === 1) return ce.number(e >= 0 ? coef : [1, coef]);
            return ce.mul([
              ce.number(coef),
              ce.power(ce.number(radicand), ce.HALF),
            ]);
          }
        }

        if (e > 0) return ce._fn('Power', [base, ce.HALF], metadata);
        return ce._fn('Power', [base, ce.number([-1, 2])], metadata);
      }

      if (base.isInfinity) {
        if (exponent.complexValue) {
          const re = exponent.complexValue.re;
          if (re === 0) return ce.NAN;
          if (re < 0) return ce.ZERO;
          if (re > 0) return ce.COMPLEX_INFINITY;
        }
        if (base.isNegative) {
          // base = -∞
          if (exponent.isInfinity) return ce.NAN;
        } else if (base.isPositive) {
          // base = +∞
          if (exponent.isNegativeOne) return ce.ZERO;
          if (exponent.isInfinity)
            return exponent.isNegative ? ce.ZERO : ce.POSITIVE_INFINITY;
        }
      }

      if (exponent.isInfinity) {
        if (base.isOne || base.isNegativeOne) return ce.NAN;
      }

      const [n, d] = base.asRational;
      if (n !== null && d !== null) {
        const e = exponent.asSmallInteger;
        if (e !== null) {
          if (e === -1) return ce.number([d, n]);
          if (e > 0) return ce.number([Math.pow(n, e), Math.pow(d, e)]);
          return ce.number([Math.pow(d, -e), Math.pow(n, -e)]);
        }

        // @todo: could call factorPower to handle \sqrt and \sqrt[3]
      }
    }
  }

  //
  // Power rule
  //
  if (base.head === 'Power' && base.op1.isReal) {
    const a = exponent.asSmallInteger;
    if (a !== null) {
      const b = base.op2.asSmallInteger;
      if (b !== null) {
        return ce._fn('Power', [base.op1, ce.number(a * b)]);
      }
    }
    if (base.op1.isNonNegative) {
      const [aN, aD] = exponent.asRational;
      if (aN !== null && aD !== null) {
        const [bN, bD] = base.op2.asRational;
        if (bN !== null && bD !== null) {
          return ce._fn('Power', [base.op1, ce.number([aN * bN, aD * bD])]);
        }
      }
    }
  }

  // Distribute over multiplication
  // (abc)^n -> a^n b^n c^n
  if (base.head === 'Multiply') {
    const e = exponent.asSmallInteger;
    if (e !== null)
      return ce._fn(
        'Multiply',
        base.ops!.map((x) => ce.power(x, exponent))
      );
  }

  return null;
}

export function square(
  ce: IComputeEngine,
  base: BoxedExpression
): BoxedExpression {
  if (base.machineValue) return ce.number(Math.pow(base.machineValue, 2));
  if (base.decimalValue) return ce.number(base.decimalValue.pow(2));
  if (base.complexValue) return ce.number(base.complexValue.pow(2));
  const [n, d] = base.rationalValue;
  if (n !== null && d !== null)
    return ce.number([Math.pow(d, 2), Math.pow(n, 2)]);

  if (base.head === 'Multiply') {
    return ce._fn(
      'Multiply',
      base.ops!.map((x) => square(ce, x))
    );
  }

  if (base.head === 'Power') {
    const exp = base.op2.asSmallInteger;
    if (exp !== null) return ce._fn('Power', [base.op1, ce.number(exp * 2)]);
    return ce._fn('Power', [base.op1, ce.mul([ce.TWO, base.op2])]);
  }

  return ce._fn('Power', [base, ce.TWO]);
}

export function processPower(
  ce: IComputeEngine,
  base: BoxedExpression,
  exponent: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  if (mode === 'N' && base.isLiteral && exponent.isLiteral) {
    if (base.complexValue) {
      return ce.number(
        base.complexValue.pow(exponent.complexValue ?? exponent.asFloat ?? NaN)
      );
    }
    if (exponent.complexValue && base.asFloat)
      return ce.number(ce.complex(base.asFloat).pow(exponent.complexValue));

    if (base.decimalValue) {
      return ce.number(
        base.decimalValue.pow(exponent.decimalValue ?? exponent.asFloat!)
      );
    }
    if (base.asFloat && (exponent.decimalValue || useDecimal(ce))) {
      return ce.number(
        ce.decimal(base.asFloat).pow(exponent.decimalValue ?? exponent.asFloat!)
      );
    }
    return ce.number(Math.pow(base.asFloat ?? NaN, exponent.asFloat ?? NaN));
  }

  //
  // Handle some specific cases: square root and cube root
  //
  if (base.asSmallInteger !== null) {
    const [n, d] = exponent.rationalValue;
    if ((n === 1 || n === -1) && (d === 2 || d === 3)) {
      //  @todo: handle rationalValue
      // @todo:handle base.machineValue < 0
      const [factor, root] = factorPower(base.asSmallInteger, d);

      if (root === 1 && factor === 1) return ce.ONE;
      if (factor === 1) return undefined;
      if (root === 1) return ce.number(n >= 0 ? factor : [1, factor]);

      return ce.mul([ce.number(factor), ce.power(ce.number(root), exponent)]);
    }
  }

  return undefined;
}
