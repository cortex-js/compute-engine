import type { BoxedExpression, RuleStep } from '../global-types';
import { asRational } from '../boxed-expression/numerics';

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
  if (op === 'Root') {
    const arg = x.op1;
    const rootIndex = x.op2;

    if (!arg || !rootIndex) return undefined;

    // Root(x^n, n) -> |x| or x depending on n
    if (arg.operator === 'Power') {
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
    }
  }

  // Handle Sqrt operator
  if (op === 'Sqrt') {
    const arg = x.op1;
    if (!arg) return undefined;

    if (arg.operator === 'Power') {
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
      }
    }

    // sqrt(a * b * ...) -> factor out perfect squares
    // sqrt(x^2 * y) -> |x| * sqrt(y)
    // sqrt(x^{2n} * y) -> |x|^n * sqrt(y)
    if (arg.operator === 'Multiply' && arg.ops) {
      const perfectSquares: BoxedExpression[] = [];
      const remaining: BoxedExpression[] = [];

      for (const factor of arg.ops) {
        if (factor.operator === 'Power' && factor.op1 && factor.op2) {
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
          remaining.length === 1
            ? remaining[0]
            : ce._fn('Multiply', remaining);

        return {
          value: outsideSqrt.mul(ce._fn('Sqrt', [insideSqrt])),
          because: 'sqrt(a^2 * b) -> |a| * sqrt(b)',
        };
      }
    }
  }

  // Handle Power operator
  if (op === 'Power') {
    const base = x.op1;
    const exp = x.op2;

    if (!base || !exp) return undefined;

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
          return { value: ce.number(-1), because: '(-1)^{p/q} -> -1 when p,q odd' };
        }
      }
    }

    // (a * b * ...)^n -> a^n * b^n * ... when n is an integer
    // Distribute exponent over product
    if (base.operator === 'Multiply' && base.ops && exp.isInteger === true) {
      const newFactors = base.ops.map((factor) => factor.pow(exp));
      return {
        value: ce._fn('Multiply', newFactors),
        because: '(a*b)^n -> a^n * b^n',
      };
    }

    // (-x)^n -> x^n when n is even, (-x)^n -> -x^n when n is odd
    if (base.operator === 'Negate' && base.op1) {
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
      }
    }

    // (sqrt(x))^n -> x^{n/2}
    if (base.operator === 'Sqrt' && base.op1) {
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
    if (base.operator === 'Root' && base.op1 && base.op2) {
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
    if (base.operator === 'Power') {
      const innerBase = base.op1;
      const innerExp = base.op2;

      if (innerBase && innerExp) {
        // Only combine when safe:
        // - both exponents are integers
        // - or base is non-negative
        // - or n*m is irrational
        // Also require at least one exponent to be positive to avoid issues
        const bothIntegers =
          innerExp.isInteger === true && exp.isInteger === true;
        const baseNonNeg = innerBase.isNonNegative === true;
        const productIrrational =
          innerExp.mul(exp).isRational === false;
        const atLeastOnePositive =
          innerExp.isPositive === true || exp.isPositive === true;

        if (
          (bothIntegers || baseNonNeg || productIrrational) &&
          atLeastOnePositive
        ) {
          return {
            value: innerBase.pow(innerExp.mul(exp)),
            because: '(x^n)^m -> x^{n*m}',
          };
        }
      }
    }

    // (a/b)^{-n} -> (b/a)^n
    if (base.operator === 'Divide' && base.op2?.is(0) === false) {
      const num = base.op1;
      const denom = base.op2;

      if (exp.operator === 'Negate') {
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
      if (exp.isNegative === true && exp.isNumberLiteral) {
        return {
          value: denom.div(num).pow(exp.neg()),
          because: '(a/b)^{-n} -> (b/a)^n',
        };
      }
    }
  }

  // Handle Divide with negative exponent in denominator
  if (op === 'Divide') {
    const num = x.op1;
    const denom = x.op2;

    if (!num || !denom) return undefined;

    // Same-base division: a^m / a^n -> a^{m-n}
    if (num.operator === 'Power' && denom.operator === 'Power') {
      const baseNum = num.op1;
      const expNum = num.op2;
      const baseDenom = denom.op1;
      const expDenom = denom.op2;

      if (baseNum?.isSame(baseDenom) && expNum && expDenom) {
        return {
          value: baseNum.pow(expNum.sub(expDenom)),
          because: 'a^m / a^n -> a^{m-n}',
        };
      }
    }

    // a^m / a -> a^{m-1}
    if (num.operator === 'Power' && num.op1?.isSame(denom)) {
      return {
        value: denom.pow(num.op2.sub(ce.One)),
        because: 'a^m / a -> a^{m-1}',
      };
    }

    // a / a^n -> a^{1-n}
    if (denom.operator === 'Power' && denom.op1?.isSame(num)) {
      return {
        value: num.pow(ce.One.sub(denom.op2)),
        because: 'a / a^n -> a^{1-n}',
      };
    }

    // a / b^{-n} -> a * b^n
    if (
      denom.operator === 'Power' &&
      denom.op1?.is(0) === false
    ) {
      const base = denom.op1;
      const exp = denom.op2;

      if (exp?.operator === 'Negate') {
        return {
          value: num.mul(base.pow(exp.op1)),
          because: 'a / b^{-n} -> a * b^n',
        };
      }
    }

    // a / (d * b^{-n}) -> (a/d) * b^n
    if (denom.operator === 'Multiply' && denom.ops) {
      for (let i = 0; i < denom.ops.length; i++) {
        const factor = denom.ops[i];
        if (
          factor.operator === 'Power' &&
          factor.op1?.is(0) === false &&
          factor.op2?.operator === 'Negate'
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
      denom.op1?.operator === 'Divide' &&
      denom.op1.op2?.is(0) === false
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
  if (op === 'Multiply' && x.ops && x.ops.length >= 2) {
    // x^n * x^m -> x^{n+m}
    // This is a more complex rule that needs to find matching bases
    // The main rule file has a more complete implementation for 3+ operands
    // Here we handle the simple 2-operand case

    if (x.ops.length === 2) {
      const [a, b] = x.ops;

      // Both are powers
      if (a.operator === 'Power' && b.operator === 'Power') {
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
      if (b.operator === 'Power' && a.isSame(b.op1)) {
        const canCombine =
          a.isPositive === true ||
          a.isNegative === true ||
          a.isNumberLiteral === true;

        if (canCombine) {
          return {
            value: a.pow(b.op2.add(ce.One)),
            because: 'x * x^n -> x^{n+1}',
          };
        }
      }

      // x^n * x -> x^{n+1}
      if (a.operator === 'Power' && b.isSame(a.op1)) {
        const canCombine =
          b.isPositive === true ||
          b.isNegative === true ||
          b.isNumberLiteral === true;

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
