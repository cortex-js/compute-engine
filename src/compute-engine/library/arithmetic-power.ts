import { preferDecimal } from '../boxed-expression/utils';
import { factorPower } from '../numerics/numeric';
import { isInMachineRange } from '../numerics/numeric-decimal';
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
  if (exponent.symbol === 'ComplexInfinity') return ce._NAN;

  if (exponent.isLiteral) {
    if (exponent.isZero) return ce._ONE;

    if (base.isLiteral) {
      const smallBase = base.machineValue ?? base.asFloat;
      //
      // Special cases
      //
      // Implement same results as sympy.
      // See https://docs.sympy.org/1.6/modules/core.html#pow
      //
      // if (base.isOne) return ce._ONE;
      // if (base.isZero) {
      if (smallBase === 1) return ce._ONE;
      if (smallBase === 0) {
        if (exponent.isPositive) return ce._ZERO;
        if (exponent.isNegative) return ce._COMPLEX_INFINITY; //  Unsigned Infinity...
      }

      if (exponent.isOne) return base;

      if (exponent.isNegativeOne) {
        // if (base.isOne) return ce._ONE;
        // if (base.isNegativeOne) return ce._NEGATIVE_ONE;
        if (smallBase === 1) return ce._ONE;
        if (smallBase === -1) return ce._NEGATIVE_ONE;
        if (base.isInfinity) return ce._ZERO;
        const [n, d] = base.rationalValue;
        if (n !== null && d !== null) return ce.number([d, n], metadata);
        const i = base.asFloat;
        if (i !== null && Number.isInteger(i))
          return ce.number([1, i], metadata);
        if (base.decimalValue?.isInteger()) {
          if (isInMachineRange(base.decimalValue))
            ce.number([1, base.decimalValue.toNumber()], metadata);
          else ce._fn('Rational', [ce._ONE, base], metadata);
        } else if (
          smallBase !== null &&
          Number.isInteger(smallBase) &&
          !base.decimalValue
        )
          return ce.number([1, smallBase], metadata);
        return ce._fn('Power', [base, ce._NEGATIVE_ONE], metadata);
      }

      // x^{0.5}, x^{1/2} -> Square Root
      const e = exponent.asFloat;
      if (e === 0.5 || e === -0.5) {
        const b = base.asSmallInteger;
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
        if (exponent.complexValue) {
          const re = exponent.complexValue.re;
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

      if (exponent.isInfinity) {
        if (base.isOne || base.isNegativeOne) return ce._NAN;
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
    return ce._fn('Power', [base.op1, ce.mul([ce._TWO, base.op2])]);
  }

  return ce._fn('Power', [base, ce._TWO]);
}

export function processPower(
  ce: IComputeEngine,
  base: BoxedExpression,
  exponent: BoxedExpression,
  mode: 'simplify' | 'evaluate' | 'N'
): BoxedExpression | undefined {
  if (mode !== 'simplify' && base.isLiteral && exponent.isLiteral) {
    if (mode === 'N' || !base.isInteger) {
      if (base.complexValue) {
        return ce.number(
          base.complexValue.pow(
            exponent.complexValue ?? exponent.asFloat ?? NaN
          )
        );
      }
      if (exponent.complexValue) {
        const b = base.asFloat ?? base.decimalValue?.toNumber() ?? null;
        if (b !== null)
          return ce.number(ce.complex(b).pow(exponent.complexValue));
      }

      if (base.decimalValue) {
        return ce.number(
          base.decimalValue.pow(exponent.decimalValue ?? exponent.asFloat!)
        );
      }

      if (
        base.asFloat !== null &&
        (exponent.decimalValue || preferDecimal(ce))
      ) {
        return ce.number(
          ce
            .decimal(base.asFloat)
            .pow(exponent.decimalValue ?? exponent.asFloat!)
        );
      }
      return ce.number(Math.pow(base.asFloat ?? NaN, exponent.asFloat ?? NaN));
    }
  }

  //
  // Handle some specific cases: square root and cube root
  //
  if (base.isLiteral && base.asSmallInteger !== null) {
    const [n, d] = exponent.rationalValue;
    if ((n === 1 || n === -1) && (d === 2 || d === 3)) {
      //  @todo: handle rationalValue
      // @todo:handle base.machineValue < 0
      const [factor, root] = factorPower(base.asSmallInteger, d);

      if (root === 1 && factor === 1) return ce._ONE;
      if (factor === 1) return undefined;
      if (root === 1) return ce.number(n >= 0 ? factor : [1, factor]);

      return ce.mul([ce.number(factor), ce.power(ce.number(root), exponent)]);
    }
  }

  if (base.head === 'Power') {
    // a^-1^-1 -> a
    if (base.op2.asSmallInteger === -1 && exponent.asSmallInteger === -1)
      return base.op1;
  }

  return undefined;
}
