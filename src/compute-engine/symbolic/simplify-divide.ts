import type { Expression, RuleStep } from '../global-types';
import { isFunction, isNumber } from '../boxed-expression/type-guards';
import { asRational } from '../boxed-expression/numerics';
import { baseOffset } from './simplify-factorial';

/**
 * Division simplification rules consolidated from simplify-rules.ts.
 *
 * Patterns:
 * - a/a -> 1 (when a ≠ 0)
 * - 1/(1/a) -> a (when a ≠ 0)
 * - a/(1/b) -> a*b (when b ≠ 0)
 * - a/(b/c) -> a*c/b (when c ≠ 0)
 * - 0/a -> 0 (when a ≠ 0)
 * - n!/k! -> partial product (concrete integers)
 * - n!/k! -> (k+1)(k+2)...n (symbolic, small constant diff)
 * - n!/k! -> Pochhammer(k+1, n-k) (symbolic, large diff)
 * - n!/(k!(n-k)!) -> Binomial(n, k)
 * - Gamma(a)/Gamma(b) -> partial product or Pochhammer
 *
 * IMPORTANT: Do not call .simplify() on results to avoid infinite recursion.
 */

export function simplifyDivide(x: Expression): RuleStep | undefined {
  if (x.operator !== 'Divide' || !isFunction(x)) return undefined;

  const num = x.op1;
  const denom = x.op2;

  if (!num || !denom) return undefined;

  const ce = x.engine;

  // 0/0 -> NaN
  if (num.is(0) && denom.is(0)) {
    return { value: ce.NaN, because: '0/0 -> NaN' };
  }

  // 0/a -> 0 when a ≠ 0
  // Note: be conservative with constant (no-unknown) denominators, since they
  // may simplify/evaluate to 0 (e.g. 1-1) and we want to avoid 0/(1-1) -> 0.
  // Those cases can be handled by an explicit preliminary evaluation.
  if (
    num.is(0) &&
    denom.is(0) === false &&
    (isNumber(denom) || denom.symbols.length !== 0)
  ) {
    return { value: ce.Zero, because: '0/a -> 0' };
  }

  // a/a -> 1 when a ≠ 0 and a is finite (∞/∞ is indeterminate)
  if (
    num.isSame(denom) &&
    num.is(0) === false &&
    num.isInfinity !== true &&
    (isNumber(num) || num.symbols.length !== 0)
  ) {
    return { value: ce.One, because: 'a/a -> 1' };
  }

  // ∞/∞ -> NaN (indeterminate form)
  if (num.isInfinity && denom.isInfinity) {
    return { value: ce.NaN, because: 'inf/inf -> NaN' };
  }

  // Check if denominator is a Divide expression
  if (denom.operator === 'Divide' && isFunction(denom)) {
    const denomNum = denom.op1;
    const denomDenom = denom.op2;

    if (!denomNum || !denomDenom) return undefined;

    // 1/(1/a) -> a when a ≠ 0
    if (num.is(1) && denomNum.is(1) && denomDenom.is(0) === false) {
      return { value: denomDenom, because: '1/(1/a) -> a' };
    }

    // a/(1/b) -> a*b when b ≠ 0
    if (denomNum.is(1) && denomDenom.is(0) === false) {
      return { value: num.mul(denomDenom), because: 'a/(1/b) -> a*b' };
    }

    // a/(b/c) -> a*c/b when c ≠ 0
    if (denomDenom.is(0) === false) {
      return {
        value: num.mul(denomDenom).div(denomNum),
        because: 'a/(b/c) -> a*c/b',
      };
    }
  }

  // Power(base, a) / Power(base, b) -> Power(base, a - b)
  // This covers cases like x^{sqrt(2)} / x^3 -> x^{sqrt(2)-3}
  // where the exponents are not rational and can't be combined during
  // canonicalization
  {
    let numBase: Expression | undefined;
    let numExp: Expression | undefined;
    let denomBase: Expression | undefined;
    let denomExp: Expression | undefined;

    if (num.operator === 'Power' && isFunction(num)) {
      numBase = num.op1;
      numExp = num.op2;
    } else {
      numBase = num;
      numExp = ce.One;
    }
    if (denom.operator === 'Power' && isFunction(denom)) {
      denomBase = denom.op1;
      denomExp = denom.op2;
    } else {
      denomBase = denom;
      denomExp = ce.One;
    }

    if (numBase && denomBase && numBase.isSame(denomBase)) {
      // Only apply when at least one exponent is non-rational (symbolic)
      // Rational cases are already handled by canonicalization
      if (!asRational(numExp!) || !asRational(denomExp!)) {
        const diffExp = ce.function('Add', [numExp!, denomExp!.neg()]);
        if (diffExp.is(0)) return { value: ce.One, because: 'x^a/x^a -> 1' };
        if (diffExp.is(1))
          return { value: numBase, because: 'x^a/x^b -> x when a-b=1' };
        return {
          value: ce._fn('Power', [numBase, diffExp]),
          because: 'x^a/x^b -> x^(a-b)',
        };
      }
    }
  }

  // ── Factorial quotient: Factorial(a) / Factorial(b) ──
  if (
    num.operator === 'Factorial' &&
    denom.operator === 'Factorial' &&
    isFunction(num) &&
    isFunction(denom)
  ) {
    const a = num.op1;
    const b = denom.op1;

    // Concrete integer case: compute partial product directly
    if (
      isNumber(a) &&
      isNumber(b) &&
      a.isInteger &&
      b.isInteger &&
      a.isNonNegative &&
      b.isNonNegative
    ) {
      const aVal = BigInt(a.re);
      const bVal = BigInt(b.re);
      if (aVal >= bVal) {
        // n!/k! = (k+1)(k+2)...n
        let result = 1n;
        for (let i = bVal + 1n; i <= aVal; i++) result *= i;
        return { value: ce.number(result), because: 'n!/k! partial product' };
      } else {
        // n < k: n!/k! = 1/((n+1)(n+2)...k)
        let result = 1n;
        for (let i = aVal + 1n; i <= bVal; i++) result *= i;
        return {
          value: ce.number([1, result]),
          because: 'n!/k! -> 1/(partial product)',
        };
      }
    }

    // Symbolic case: check if a and b differ by a small integer constant
    const aBO = baseOffset(a);
    const bBO = baseOffset(b);
    if (aBO && bBO && aBO.base.isSame(bBO.base)) {
      const d = aBO.offset - bBO.offset;
      if (Number.isInteger(d) && d >= 1 && d <= 8) {
        // a!/b! = (b+1)(b+2)...a
        let product: Expression = b.add(ce.One);
        for (let i = 2; i <= d; i++) {
          product = product.mul(b.add(ce.number(i)));
        }
        return { value: product, because: 'n!/k! -> (k+1)..n' };
      }
      if (Number.isInteger(d) && d <= -1 && d >= -8) {
        // a < b: a!/b! = 1/((a+1)(a+2)...b)
        let product: Expression = a.add(ce.One);
        for (let i = 2; i <= -d; i++) {
          product = product.mul(a.add(ce.number(i)));
        }
        return {
          value: ce.One.div(product),
          because: 'n!/k! -> 1/((n+1)..k)',
        };
      }
      // Large symbolic diff: express as Pochhammer
      // a!/b! = Pochhammer(b+1, a-b) when a > b (diff > 0)
      // a!/b! = 1/Pochhammer(a+1, b-a) when a < b (diff < 0)
      if (Number.isInteger(d) && d > 8) {
        const count = a.sub(b);
        return {
          value: ce._fn('Pochhammer', [b.add(ce.One), count]),
          because: 'n!/k! -> Pochhammer(k+1, n-k)',
        };
      }
      if (Number.isInteger(d) && d < -8) {
        const count = b.sub(a);
        return {
          value: ce.One.div(ce._fn('Pochhammer', [a.add(ce.One), count])),
          because: 'n!/k! -> 1/Pochhammer(n+1, k-n)',
        };
      }
    }
  }

  // ── Binomial detection: n! / (k! * (n-k)!) → Binomial(n, k) ──
  if (
    num.operator === 'Factorial' &&
    isFunction(num) &&
    denom.operator === 'Multiply' &&
    isFunction(denom)
  ) {
    const n = num.op1;
    const factorialOps = denom.ops.filter(
      (op) => op.operator === 'Factorial' && isFunction(op)
    );
    const otherOps = denom.ops.filter(
      (op) => !(op.operator === 'Factorial' && isFunction(op))
    );

    if (
      factorialOps.length === 2 &&
      otherOps.length === 0 &&
      isFunction(factorialOps[0]) &&
      isFunction(factorialOps[1])
    ) {
      const k = factorialOps[0].op1;
      const m = factorialOps[1].op1;

      // Check if k + m = n (numeric)
      if (
        isNumber(n) &&
        isNumber(k) &&
        isNumber(m) &&
        k.re + m.re === n.re
      ) {
        // Use the smaller of k, m for efficiency
        const smaller = k.re <= m.re ? k : m;
        return {
          value: ce._fn('Binomial', [n, smaller]),
          because: 'n!/(k!(n-k)!) -> Binomial',
        };
      }

      // Symbolic: check if k + m structurally equals n
      const sum = k.add(m);
      if (sum.isSame(n)) {
        return {
          value: ce._fn('Binomial', [n, k]),
          because: 'n!/(k!(n-k)!) -> Binomial',
        };
      }
    }
  }

  // ── Gamma quotient: Gamma(a) / Gamma(b) → factorial quotient ──
  // Gamma(n+1)/Gamma(k+1) = n!/k!
  if (
    num.operator === 'Gamma' &&
    denom.operator === 'Gamma' &&
    isFunction(num) &&
    isFunction(denom)
  ) {
    const a = num.op1;
    const b = denom.op1;
    const aBO = baseOffset(a);
    const bBO = baseOffset(b);
    if (aBO && bBO && aBO.base.isSame(bBO.base)) {
      const d = aBO.offset - bBO.offset;
      if (Number.isInteger(d) && d !== 0) {
        // Gamma(a)/Gamma(b) = (b)(b+1)...(a-1) when a > b
        // Gamma(a)/Gamma(b) = 1/((a)(a+1)...(b-1)) when a < b
        if (d >= 1 && d <= 8) {
          let product: Expression = b;
          for (let i = 1; i < d; i++) {
            product = product.mul(b.add(ce.number(i)));
          }
          return { value: product, because: 'Gamma(a)/Gamma(b) quotient' };
        }
        if (d <= -1 && d >= -8) {
          let product: Expression = a;
          for (let i = 1; i < -d; i++) {
            product = product.mul(a.add(ce.number(i)));
          }
          return {
            value: ce.One.div(product),
            because: 'Gamma(a)/Gamma(b) quotient',
          };
        }
        // Large diff: use Pochhammer
        if (d > 8) {
          return {
            value: ce._fn('Pochhammer', [b, ce.number(d)]),
            because: 'Gamma(a)/Gamma(b) -> Pochhammer',
          };
        }
        if (d < -8) {
          return {
            value: ce.One.div(ce._fn('Pochhammer', [a, ce.number(-d)])),
            because: 'Gamma(a)/Gamma(b) -> 1/Pochhammer',
          };
        }
      }
    }
  }

  return undefined;
}
