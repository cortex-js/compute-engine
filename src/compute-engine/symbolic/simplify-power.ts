import type { BoxedExpression, RuleStep } from '../global-types';
import { asRational } from '../boxed-expression/numerics';
import {
  factorPerfectSquare,
  factorDifferenceOfSquares,
} from '../boxed-expression/factor';
import {
  isBoxedFunction,
  isBoxedNumber,
} from '../boxed-expression/type-guards';

/**
 * Power simplification rules consolidated from simplify-rules.ts.
 * Handles ~25 patterns for simplifying Power expressions.
 *
 * Categories:
 * - Basic power rules: x^0, x^1, 0^x, 1^x
 * - Power combination: x^n * x^m -> x^{n+m}
 * - Nested powers: (x^n)^m -> x^{n*m}
 * - Root simplifications: sqrt(x^2) -> |x|
 * - Negative exponent in denominator
 *
 * IMPORTANT: Do not call .simplify() on results to avoid infinite recursion.
 */

export function simplifyPower(x: BoxedExpression): RuleStep | undefined {
  const op = x.operator;
  const ce = x.engine;

  // Handle Root operator
  if (op === 'Root' && isBoxedFunction(x)) {
    const arg = x.op1;
    const rootIndex = x.op2;

    if (!arg || !rootIndex) return undefined;

    // Edge case: 0th root is undefined -> NaN
    if (rootIndex.is(0)) {
      return { value: ce.NaN, because: 'root(x, 0) -> NaN' };
    }

    // Edge case: root(0, n)
    if (arg.is(0)) {
      if (rootIndex.isPositive === true) {
        return { value: ce.Zero, because: 'root(0, n) -> 0 when n > 0' };
      }
      return { value: ce.NaN, because: 'root(0, n) -> NaN when n <= 0' };
    }

    // Edge case: root(1, n) = 1 for all nonzero n
    if (arg.is(1)) {
      return { value: ce.One, because: 'root(1, n) -> 1' };
    }

    // Edge case: root(+inf, n) -> +inf when n > 0
    if (arg.isInfinity === true && arg.isPositive === true) {
      if (rootIndex.isPositive === true) {
        return {
          value: ce.PositiveInfinity,
          because: 'root(+inf, n) -> +inf when n > 0',
        };
      }
      if (rootIndex.isNegative === true) {
        return { value: ce.Zero, because: 'root(+inf, n) -> 0 when n < 0' };
      }
    }

    // Sign extraction for odd roots: root(-a, n) -> -root(a, n) when n is odd
    if (rootIndex.isOdd === true && arg.isNegative === true) {
      return {
        value: ce._fn('Root', [arg.neg(), rootIndex]).neg(),
        because: 'root(-a, n) -> -root(a, n) when n odd',
      };
    }

    // root(sqrt(x), n) -> x^{1/(2n)} (nth root of square root)
    if (arg.operator === 'Sqrt' && isBoxedFunction(arg) && arg.op1) {
      const innerBase = arg.op1;
      // root(sqrt(x), n) = x^{1/(2n)}
      return {
        value: innerBase.pow(ce.One.div(ce.number(2).mul(rootIndex))),
        because: 'root(sqrt(x), n) -> x^{1/(2n)}',
      };
    }

    // root(root(x, m), n) -> x^{1/(m*n)} (nested roots)
    if (arg.operator === 'Root' && isBoxedFunction(arg) && arg.op1 && arg.op2) {
      const innerBase = arg.op1;
      const innerRootIndex = arg.op2;
      // root(root(x, m), n) = x^{1/(m*n)}
      return {
        value: innerBase.pow(ce.One.div(innerRootIndex.mul(rootIndex))),
        because: 'root(root(x, m), n) -> x^{1/(m*n)}',
      };
    }

    // Root(x^n, n) -> |x| or x depending on n
    if (arg.operator === 'Power' && isBoxedFunction(arg)) {
      const base = arg.op1;
      const exp = arg.op2;

      if (base && exp?.isSame(rootIndex)) {
        // Even root: return |x|
        if (rootIndex.isEven === true) {
          return {
            value: ce._fn('Abs', [base]),
            because: 'root(x^n, n) -> |x| when n even',
          };
        }
        // Odd root or x >= 0: return x
        if (rootIndex.isOdd === true || base.isNonNegative === true) {
          return { value: base, because: 'root(x^n, n) -> x when n odd' };
        }
      }

      // Generalized root simplification: root(x^m, n) -> x^{m/n} or |x|^{m/n}
      // Examples: root(x^6, 4) -> |x|^{3/2}, root(x^6, 3) -> x^2, root(x^8, 4) -> x^2
      if (base && exp) {
        // Get the resulting exponent m/n
        const resultExp = exp.div(rootIndex);

        // For even root index, we need |x|^{m/n}
        if (rootIndex.isEven === true) {
          // Only simplify if m/n is simpler than root form
          // (i.e., m/n is a rational with smaller denominator than n, or an integer)
          if (resultExp.isInteger === true) {
            // root(x^m, n) -> |x|^k when m/n = k is integer
            return {
              value: ce._fn('Abs', [base]).pow(resultExp),
              because: 'root(x^m, n) -> |x|^{m/n} when m/n is integer',
            };
          }
          // For non-integer m/n, still simplify to |x|^{m/n} form
          // This is simpler than root(x^m, n)
          const rat = asRational(resultExp);
          if (rat) {
            const [, denom] = rat;
            const rootN = asRational(rootIndex);
            // Only simplify if the new denominator is smaller
            if (rootN && Number(denom) < Number(rootN[0])) {
              return {
                value: ce._fn('Abs', [base]).pow(resultExp),
                because: 'root(x^m, n) -> |x|^{m/n}',
              };
            }
          }
        }

        // For odd root index: root(x^m, n) -> x^{m/n}
        // Odd roots are single-valued for all real numbers, so this is always valid
        if (rootIndex.isOdd === true && exp.isInteger === true) {
          return {
            value: base.pow(resultExp),
            because: 'root(x^m, n) -> x^{m/n} when n is odd',
          };
        }

        // If x is non-negative, we can always simplify
        if (base.isNonNegative === true) {
          if (resultExp.isInteger === true) {
            return {
              value: base.pow(resultExp),
              because: 'root(x^m, n) -> x^{m/n} when x >= 0',
            };
          }
        }
      }
    }

    // Root of Multiply: root(a*b*..., n) -> root(a,n) * root(b,n) * ...
    // Distribute root over product when some factors have perfect nth roots
    if (
      arg.operator === 'Multiply' &&
      isBoxedFunction(arg) &&
      arg.ops.length >= 2
    ) {
      const n = rootIndex.re;
      if (n !== undefined && Number.isInteger(n) && n >= 2) {
        const insideRoot: BoxedExpression[] = [];
        const outsideRoot: BoxedExpression[] = [];

        for (const factor of arg.ops) {
          // Try to simplify root(factor, n) individually
          const rootOfFactor = ce._fn('Root', [factor, rootIndex]);
          const simplified = simplifyPower(rootOfFactor);
          if (simplified && !simplified.value.isSame(rootOfFactor)) {
            outsideRoot.push(simplified.value);
          } else {
            // Check if factor is a numeric perfect nth power
            const numVal = factor.re;
            if (numVal !== undefined && numVal > 0) {
              const nthRoot = Math.round(Math.pow(numVal, 1 / n));
              if (Math.pow(nthRoot, n) === numVal) {
                outsideRoot.push(ce.number(nthRoot));
                continue;
              }
            }
            insideRoot.push(factor);
          }
        }

        if (outsideRoot.length > 0) {
          const outside =
            outsideRoot.length === 1
              ? outsideRoot[0]
              : ce._fn('Multiply', outsideRoot);
          if (insideRoot.length === 0) {
            return {
              value: outside,
              because: 'root(product, n) -> factored',
            };
          }
          const inside =
            insideRoot.length === 1
              ? insideRoot[0]
              : ce._fn('Multiply', insideRoot);
          return {
            value: ce._fn('Multiply', [
              outside,
              ce._fn('Root', [inside, rootIndex]),
            ]),
            because: 'root(product, n) -> factored',
          };
        }
      }
    }
  }

  // Handle Sqrt operator
  if (op === 'Sqrt' && isBoxedFunction(x)) {
    const arg = x.op1;
    if (!arg) return undefined;

    // Edge case: sqrt(+inf) -> +inf
    if (arg.isInfinity === true && arg.isPositive === true) {
      return { value: ce.PositiveInfinity, because: 'sqrt(+inf) -> +inf' };
    }

    // Try factoring perfect square trinomials and difference of squares first
    // This enables simplification of sqrt(x^2+2x+1) -> |x+1|
    if (arg.operator === 'Add') {
      // Try perfect square trinomial: a² ± 2ab + b² → (a±b)²
      const perfectSquare = factorPerfectSquare(arg);
      if (perfectSquare !== null) {
        // We have (a±b)², so sqrt((a±b)²) = |a±b|
        const base = isBoxedFunction(perfectSquare)
          ? perfectSquare.op1
          : perfectSquare;
        return {
          value: ce._fn('Abs', [base]),
          because: 'sqrt(perfect square trinomial) -> |factor|',
        };
      }

      // Try difference of squares: a² - b² → (a-b)(a+b)
      const diffSquares = factorDifferenceOfSquares(arg);
      if (diffSquares !== null) {
        // We have (a-b)(a+b), so sqrt((a-b)(a+b)) = sqrt(a²-b²)
        // This doesn't simplify further directly, but we return the factored form
        // wrapped in sqrt for further simplification
        return {
          value: ce._fn('Sqrt', [diffSquares]),
          because: 'sqrt(a²-b²) -> sqrt((a-b)(a+b))',
        };
      }
    }

    // sqrt(sqrt(x)) -> x^{1/4} (nested square roots)
    if (arg.operator === 'Sqrt' && isBoxedFunction(arg) && arg.op1) {
      return {
        value: arg.op1.pow(ce.number([1, 4])),
        because: 'sqrt(sqrt(x)) -> x^{1/4}',
      };
    }

    // sqrt(root(x, n)) -> x^{1/(2n)} (square root of nth root)
    if (arg.operator === 'Root' && isBoxedFunction(arg) && arg.op1 && arg.op2) {
      const innerBase = arg.op1;
      const rootIndex = arg.op2;
      // sqrt(root(x, n)) = x^{1/(2n)}
      return {
        value: innerBase.pow(ce.One.div(ce.number(2).mul(rootIndex))),
        because: 'sqrt(root(x, n)) -> x^{1/(2n)}',
      };
    }

    if (arg.operator === 'Power' && isBoxedFunction(arg)) {
      const base = arg.op1;
      const exp = arg.op2;

      if (base && exp) {
        // sqrt(x^2) -> x when x is non-negative
        if (exp.is(2) && base.isNonNegative === true) {
          return { value: base, because: 'sqrt(x^2) -> x when x >= 0' };
        }

        // sqrt(x^2) -> |x| (general case)
        if (exp.is(2)) {
          return { value: ce._fn('Abs', [base]), because: 'sqrt(x^2) -> |x|' };
        }

        // sqrt(x^{2n}) -> |x|^n for positive integer n
        if (exp.isEven === true && exp.isPositive === true) {
          return {
            value: ce._fn('Abs', [base]).pow(exp.div(2)),
            because: 'sqrt(x^{2n}) -> |x|^n',
          };
        }

        // sqrt(x^{2n+1}) -> |x|^n * sqrt(x) for positive integer n
        // e.g., sqrt(x^5) = sqrt(x^4 * x) = |x|^2 * sqrt(x)
        if (
          exp.isOdd === true &&
          exp.isInteger === true &&
          exp.isPositive === true
        ) {
          const n = exp.sub(ce.One).div(2);
          if (n.isPositive === true) {
            return {
              value: ce
                ._fn('Abs', [base])
                .pow(n)
                .mul(ce._fn('Sqrt', [base])),
              because: 'sqrt(x^{2n+1}) -> |x|^n * sqrt(x)',
            };
          }
        }
      }
    }

    // sqrt(a * b * ...) -> factor out perfect squares
    // sqrt(x^2 * y) -> |x| * sqrt(y)
    // sqrt(x^{2n} * y) -> |x|^n * sqrt(y)
    if (arg.operator === 'Multiply' && isBoxedFunction(arg)) {
      const perfectSquares: BoxedExpression[] = [];
      const remaining: BoxedExpression[] = [];

      for (const factor of arg.ops) {
        if (
          factor.operator === 'Power' &&
          isBoxedFunction(factor) &&
          factor.op1 &&
          factor.op2
        ) {
          const base = factor.op1;
          const exp = factor.op2;
          // x^2 -> |x| outside, nothing inside
          if (exp.is(2)) {
            perfectSquares.push(ce._fn('Abs', [base]));
          }
          // x^{2n} -> |x|^n outside, nothing inside
          else if (exp.isEven === true && exp.isPositive === true) {
            perfectSquares.push(ce._fn('Abs', [base]).pow(exp.div(2)));
          }
          // x^{2n+1} -> |x|^n outside, x inside (for positive even part)
          else if (
            exp.isInteger === true &&
            exp.isPositive === true &&
            exp.isOdd === true
          ) {
            // Split: x^{2n+1} = x^{2n} * x
            // sqrt(x^{2n+1}) = |x|^n * sqrt(x)
            const n = exp.sub(ce.One).div(2);
            if (n.isPositive === true) {
              perfectSquares.push(ce._fn('Abs', [base]).pow(n));
            }
            remaining.push(base);
          } else {
            remaining.push(factor);
          }
        } else {
          remaining.push(factor);
        }
      }

      // Only simplify if we found at least one perfect square
      if (perfectSquares.length > 0) {
        const outsideSqrt =
          perfectSquares.length === 1
            ? perfectSquares[0]
            : ce._fn('Multiply', perfectSquares);

        if (remaining.length === 0) {
          return {
            value: outsideSqrt,
            because: 'sqrt(a^2 * ...) -> |a| * ...',
          };
        }

        const insideSqrt =
          remaining.length === 1 ? remaining[0] : ce._fn('Multiply', remaining);

        return {
          value: outsideSqrt.mul(ce._fn('Sqrt', [insideSqrt])),
          because: 'sqrt(a^2 * b) -> |a| * sqrt(b)',
        };
      }
    }
  }

  // Handle Power operator
  if (op === 'Power' && isBoxedFunction(x)) {
    const base = x.op1;
    const exp = x.op2;

    if (!base || !exp) return undefined;

    // x^1 -> x
    if (exp.is(1)) {
      return { value: base, because: 'x^1 -> x' };
    }

    // 0^x -> 0 when x is positive (including symbolic like π)
    // Note: 0^0 = NaN and 0^(-x) = ComplexInfinity are handled elsewhere
    if (base.is(0) && exp.isPositive === true) {
      return { value: ce.Zero, because: '0^x -> 0 when x > 0' };
    }

    // (-1)^{p/q} -> -1 when both p and q are odd (real odd root of -1)
    // This handles the literal -1 case (not Negate(1))
    if (base.is(-1)) {
      const rat = asRational(exp);
      if (rat) {
        const [num, denom] = rat;
        const numN = Number(num);
        const denomN = Number(denom);
        // Both numerator and denominator odd means real root exists
        if (numN % 2 !== 0 && denomN % 2 !== 0) {
          return {
            value: ce.number(-1),
            because: '(-1)^{p/q} -> -1 when p,q odd',
          };
        }
      }
    }

    // (negative * b * ...)^{p/q} -> -(positive * b * ...)^{p/q} when p,q odd
    // e.g., (-2x)^{3/5} -> -(2x)^{3/5}
    // This handles products like Multiply(-2, x) raised to a rational power
    if (base.operator === 'Multiply' && isBoxedFunction(base)) {
      const rat = asRational(exp);
      if (rat) {
        const [num, denom] = rat;
        const numN = Number(num);
        const denomN = Number(denom);
        const numIsOdd = numN % 2 !== 0;
        const denomIsOdd = denomN % 2 !== 0;

        if (numIsOdd && denomIsOdd) {
          // Find if there's a negative numeric coefficient
          let negativeIndex = -1;
          for (let i = 0; i < base.ops.length; i++) {
            const factor = base.ops[i];
            if (isBoxedNumber(factor) && factor.isNegative === true) {
              negativeIndex = i;
              break;
            }
          }

          if (negativeIndex >= 0) {
            // Factor out the sign: (-a * b)^{p/q} = -(a * b)^{p/q} when p,q odd
            const negFactor = base.ops[negativeIndex];
            const posFactor = negFactor.neg();
            const newFactors = base.ops.map((f, i) =>
              i === negativeIndex ? posFactor : f
            );
            const posBase =
              newFactors.length === 1
                ? newFactors[0]
                : ce._fn('Multiply', newFactors);
            return {
              value: posBase.pow(exp).neg(),
              because: '(-a*b)^{p/q} -> -(a*b)^{p/q} when p,q odd',
            };
          }
        }
      }
    }

    // (a * b * ...)^n -> a^n * b^n * ... when n is an integer
    // Distribute exponent over product
    if (
      base.operator === 'Multiply' &&
      isBoxedFunction(base) &&
      exp.isInteger === true
    ) {
      const newFactors = base.ops.map((factor) => factor.pow(exp));
      return {
        value: ce._fn('Multiply', newFactors),
        because: '(a*b)^n -> a^n * b^n',
      };
    }

    // (-x)^n -> x^n when n is even, (-x)^n -> -x^n when n is odd
    if (base.operator === 'Negate' && isBoxedFunction(base)) {
      const innerBase = base.op1;

      // Handle integer exponents
      if (exp.isEven === true) {
        // (-x)^{even} -> x^{even}
        return {
          value: innerBase.pow(exp),
          because: '(-x)^n -> x^n when n is even',
        };
      }
      if (exp.isOdd === true) {
        // (-x)^{odd} -> -(x^{odd})
        return {
          value: innerBase.pow(exp).neg(),
          because: '(-x)^n -> -x^n when n is odd',
        };
      }

      // Handle rational exponents n/m where we can determine parity
      // Rational exponents may be stored as Number with rational numericValue
      const rat = asRational(exp);
      if (rat) {
        const [num, denom] = rat;
        // Convert to Number for modulo operation (safe for small integers)
        const numN = Number(num);
        const denomN = Number(denom);
        const numIsEven = numN % 2 === 0;
        const numIsOdd = numN % 2 !== 0;
        const denomIsOdd = denomN % 2 !== 0;

        // (-x)^{even/odd} -> x^{even/odd} (e.g., (-x)^{4/3} -> x^{4/3})
        if (numIsEven && denomIsOdd) {
          return {
            value: innerBase.pow(exp),
            because: '(-x)^{n/m} -> x^{n/m} when n is even and m is odd',
          };
        }
        // (-x)^{odd/odd} -> -(x^{odd/odd}) (e.g., (-x)^{3/5} -> -(x^{3/5}))
        if (numIsOdd && denomIsOdd) {
          return {
            value: innerBase.pow(exp).neg(),
            because: '(-x)^{n/m} -> -x^{n/m} when n and m are odd',
          };
        }
        // (-x)^{odd/even} -> x^{odd/even} (e.g., (-x)^{3/4} -> x^{3/4})
        // Even root eliminates the sign
        if (numIsOdd && !denomIsOdd) {
          return {
            value: innerBase.pow(exp),
            because: '(-x)^{n/m} -> x^{n/m} when m is even',
          };
        }
      }
    }

    // (sqrt(x))^n -> x^{n/2}
    if (base.operator === 'Sqrt' && isBoxedFunction(base)) {
      const innerBase = base.op1;
      // sqrt(x)^n = x^{n/2}
      // Safe when: n is even (result is integer power), or x is non-negative
      if (exp.isEven === true) {
        // sqrt(x)^{2k} = x^k - always valid
        return {
          value: innerBase.pow(exp.div(2)),
          because: 'sqrt(x)^n -> x^{n/2} when n is even',
        };
      }
      if (innerBase.isNonNegative === true) {
        // sqrt(x)^n = x^{n/2} when x >= 0
        return {
          value: innerBase.pow(exp.div(2)),
          because: 'sqrt(x)^n -> x^{n/2} when x >= 0',
        };
      }
    }

    // (root(x, k))^n -> x^{n/k}
    if (base.operator === 'Root' && isBoxedFunction(base)) {
      const innerBase = base.op1;
      const rootIndex = base.op2;
      // root(x, k)^n = x^{n/k}
      // Safe when result exponent is integer, or x is non-negative
      const resultExp = exp.div(rootIndex);
      if (resultExp.isInteger === true || innerBase.isNonNegative === true) {
        return {
          value: innerBase.pow(resultExp),
          because: 'root(x, k)^n -> x^{n/k}',
        };
      }
    }

    // (x^n)^m -> x^{n*m} under certain conditions
    if (base.operator === 'Power' && isBoxedFunction(base)) {
      const innerBase = base.op1;
      const innerExp = base.op2;

      if (innerBase && innerExp) {
        // (a^n)^m -> a^{n*m} only when mathematically safe:
        // - base is non-negative (no sign info to lose)
        // - outer exponent m is integer (repeated multiplication is safe)
        // - inner exponent n is odd integer (sign-preserving bijection)
        const baseNonNeg = innerBase.isNonNegative === true;
        const outerIsInteger = exp.isInteger === true;
        const innerIsOddInteger =
          innerExp.isInteger === true && innerExp.isOdd === true;

        if (baseNonNeg || outerIsInteger || innerIsOddInteger) {
          return {
            value: innerBase.pow(innerExp.mul(exp)),
            because: '(x^n)^m -> x^{n*m}',
          };
        }
      }
    }

    // (a/b)^{-n} -> (b/a)^n
    if (
      base.operator === 'Divide' &&
      isBoxedFunction(base) &&
      base.op2.is(0) === false
    ) {
      const num = base.op1;
      const denom = base.op2;

      if (exp.operator === 'Negate' && isBoxedFunction(exp)) {
        return {
          value: denom.div(num).pow(exp.op1),
          because: '(a/b)^{-n} -> (b/a)^n',
        };
      }

      // (a/b)^{-1} -> b/a
      if (exp.is(-1)) {
        return { value: denom.div(num), because: '(a/b)^{-1} -> b/a' };
      }

      // (a/b)^{negative number} -> (b/a)^{positive number}
      // Handle numeric negative exponents like (a/b)^{-2} -> (b/a)^2
      if (exp.isNegative === true && isBoxedNumber(exp)) {
        return {
          value: denom.div(num).pow(exp.neg()),
          because: '(a/b)^{-n} -> (b/a)^n',
        };
      }
    }
  }

  // Handle Divide with negative exponent in denominator
  if (op === 'Divide' && isBoxedFunction(x)) {
    const num = x.op1;
    const denom = x.op2;

    if (!num || !denom) return undefined;

    // Same-base division: a^m / a^n -> a^{m-n}
    if (
      num.operator === 'Power' &&
      isBoxedFunction(num) &&
      denom.operator === 'Power' &&
      isBoxedFunction(denom)
    ) {
      const baseNum = num.op1;
      const expNum = num.op2;
      const baseDenom = denom.op1;
      const expDenom = denom.op2;

      if (baseNum?.isSame(baseDenom) && expNum && expDenom) {
        // Use symbolic Add to preserve exact forms (e.g., sqrt(2) - 3)
        // instead of .sub() which evaluates numerically
        const diffExp = ce.function('Add', [expNum, expDenom.neg()]);
        return {
          value: baseNum.pow(diffExp),
          because: 'a^m / a^n -> a^{m-n}',
        };
      }
    }

    // a^m / a -> a^{m-1}
    if (
      num.operator === 'Power' &&
      isBoxedFunction(num) &&
      num.op1.isSame(denom)
    ) {
      const diffExp = ce.function('Add', [num.op2, ce.NegativeOne]);
      return {
        value: denom.pow(diffExp),
        because: 'a^m / a -> a^{m-1}',
      };
    }

    // a / a^n -> a^{1-n}
    if (
      denom.operator === 'Power' &&
      isBoxedFunction(denom) &&
      denom.op1.isSame(num)
    ) {
      const diffExp = ce.function('Add', [ce.One, denom.op2.neg()]);
      return {
        value: num.pow(diffExp),
        because: 'a / a^n -> a^{1-n}',
      };
    }

    // a / b^{-n} -> a * b^n
    if (
      denom.operator === 'Power' &&
      isBoxedFunction(denom) &&
      denom.op1.is(0) === false
    ) {
      const base = denom.op1;
      const exp = denom.op2;

      if (exp.operator === 'Negate' && isBoxedFunction(exp)) {
        return {
          value: num.mul(base.pow(exp.op1)),
          because: 'a / b^{-n} -> a * b^n',
        };
      }
    }

    // a / (d * b^{-n}) -> (a/d) * b^n
    if (denom.operator === 'Multiply' && isBoxedFunction(denom)) {
      for (let i = 0; i < denom.ops.length; i++) {
        const factor = denom.ops[i];
        if (
          factor.operator === 'Power' &&
          isBoxedFunction(factor) &&
          factor.op1.is(0) === false &&
          factor.op2.operator === 'Negate' &&
          isBoxedFunction(factor.op2)
        ) {
          const base = factor.op1;
          const posExp = factor.op2.op1;
          const otherFactors = denom.ops.filter((_, idx) => idx !== i);
          const d =
            otherFactors.length === 1
              ? otherFactors[0]
              : ce._fn('Multiply', otherFactors);
          return {
            value: num.div(d).mul(base.pow(posExp)),
            because: 'a / (d * b^{-n}) -> (a/d) * b^n',
          };
        }
      }
    }

    // a / (b/c)^d -> a * (c/b)^d
    if (
      denom.operator === 'Power' &&
      isBoxedFunction(denom) &&
      denom.op1.operator === 'Divide' &&
      isBoxedFunction(denom.op1) &&
      denom.op1.op2.is(0) !== true
    ) {
      const fracNum = denom.op1.op1;
      const fracDenom = denom.op1.op2;
      const exp = denom.op2;
      return {
        value: num.mul(fracDenom.div(fracNum).pow(exp)),
        because: 'a / (b/c)^d -> a * (c/b)^d',
      };
    }
  }

  // Handle Multiply for power combination
  if (op === 'Multiply' && isBoxedFunction(x) && x.ops.length >= 2) {
    // x^n * x^m -> x^{n+m}
    // This is a more complex rule that needs to find matching bases
    // The main rule file has a more complete implementation for 3+ operands
    // Here we handle the simple 2-operand case

    if (x.ops.length === 2) {
      const [a, b] = x.ops;

      // Both are powers
      if (
        a.operator === 'Power' &&
        isBoxedFunction(a) &&
        b.operator === 'Power' &&
        isBoxedFunction(b)
      ) {
        const baseA = a.op1;
        const expA = a.op2;
        const baseB = b.op1;
        const expB = b.op2;

        if (baseA?.isSame(baseB) && expA && expB) {
          // Only combine if base is non-zero or sum of exponents is non-negative
          const canCombine =
            baseA.isPositive === true ||
            baseA.isNegative === true ||
            expA.add(expB).isNonNegative === true;

          if (canCombine) {
            return {
              value: baseA.pow(expA.add(expB)),
              because: 'x^n * x^m -> x^{n+m}',
            };
          }
        }
      }

      // x * x^n -> x^{n+1}
      if (b.operator === 'Power' && isBoxedFunction(b) && a.isSame(b.op1)) {
        const canCombine =
          a.isPositive === true || a.isNegative === true || isBoxedNumber(a);

        if (canCombine) {
          return {
            value: a.pow(b.op2.add(ce.One)),
            because: 'x * x^n -> x^{n+1}',
          };
        }
      }

      // x^n * x -> x^{n+1}
      if (a.operator === 'Power' && isBoxedFunction(a) && b.isSame(a.op1)) {
        const canCombine =
          b.isPositive === true || b.isNegative === true || isBoxedNumber(b);

        if (canCombine) {
          return {
            value: b.pow(a.op2.add(ce.One)),
            because: 'x^n * x -> x^{n+1}',
          };
        }
      }
    }
  }

  return undefined;
}
