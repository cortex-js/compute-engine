import type { Expression, RuleStep } from '../global-types';
import { isFunction, isNumber, isSymbol } from '../boxed-expression/type-guards';

/**
 * Extracts base + integer offset from an expression.
 * - Symbol `n` → { base: n, offset: 0 }
 * - Add(n, 3) → { base: n, offset: 3 }
 * - Add(n, -2) → { base: n, offset: -2 }
 * - Multiply(2, x) → { base: Multiply(2, x), offset: 0 }
 * - Number → null (pure numeric, no symbolic base)
 */
export function baseOffset(
  expr: Expression
): { base: Expression; offset: number } | null {
  if (isNumber(expr)) return null;

  if (expr.operator === 'Add' && isFunction(expr) && expr.nops === 2) {
    const [op1, op2] = [expr.op1, expr.op2];
    if (isNumber(op2) && Number.isInteger(op2.re) && !isNumber(op1))
      return { base: op1, offset: op2.re };
    if (isNumber(op1) && Number.isInteger(op1.re) && !isNumber(op2))
      return { base: op2, offset: op1.re };
  }

  return { base: expr, offset: 0 };
}

/**
 * Simplification rules for Binomial and Choose expressions.
 *
 * Patterns:
 * - C(n, 0) → 1
 * - C(n, 1) → n
 * - C(n, n) → 1
 * - C(n, n-1) → n
 */
export function simplifyBinomial(x: Expression): RuleStep | undefined {
  if (x.operator !== 'Binomial' && x.operator !== 'Choose') return undefined;
  if (!isFunction(x)) return undefined;

  const n = x.op1;
  const k = x.op2;
  if (!n || !k) return undefined;

  const ce = x.engine;

  // C(n, 0) → 1
  if (k.is(0)) return { value: ce.One, because: 'C(n,0) -> 1' };

  // C(n, 1) → n
  if (k.is(1)) return { value: n, because: 'C(n,1) -> n' };

  // C(n, n) → 1
  if (k.isSame(n)) return { value: ce.One, because: 'C(n,n) -> 1' };

  // C(n, n-1) → n (structural check via baseOffset)
  const nBO = baseOffset(n);
  const kBO = baseOffset(k);
  if (
    nBO &&
    kBO &&
    nBO.base.isSame(kBO.base) &&
    nBO.offset - kBO.offset === 1
  )
    return { value: n, because: 'C(n,n-1) -> n' };

  return undefined;
}

/**
 * Extracts factorial information from a term in an Add expression.
 * Handles: Factorial(n), Negate(Factorial(n)), Multiply(c, Factorial(n))
 */
function extractFactorialTerm(
  term: Expression
): { coeff: number; factArg: Expression } | null {
  // Direct: Factorial(n)
  if (term.operator === 'Factorial' && isFunction(term))
    return { coeff: 1, factArg: term.op1 };

  // Negate(Factorial(n))
  if (
    term.operator === 'Negate' &&
    isFunction(term) &&
    term.op1.operator === 'Factorial' &&
    isFunction(term.op1)
  )
    return { coeff: -1, factArg: term.op1.op1 };

  // Multiply with integer coefficient and Factorial
  if (term.operator === 'Multiply' && isFunction(term)) {
    const ops = term.ops;
    let factIdx = -1;
    for (let i = 0; i < ops.length; i++) {
      if (ops[i].operator === 'Factorial' && isFunction(ops[i])) {
        if (factIdx >= 0) return null; // Multiple factorials
        factIdx = i;
      }
    }
    if (factIdx < 0) return null;

    const factOp = ops[factIdx];
    if (!isFunction(factOp)) return null;
    const factArg = factOp.op1;
    const others = ops.filter((_, i) => i !== factIdx);

    if (
      others.length === 1 &&
      isNumber(others[0]) &&
      Number.isInteger(others[0].re)
    )
      return { coeff: others[0].re, factArg };

    return null;
  }

  return null;
}

/**
 * Simplification for Add expressions containing factorial terms.
 * Factors out the common (smallest) factorial for symbolic expressions.
 *
 * Examples:
 * - n! - (n-1)! → (n-1)! * (n - 1)
 * - (n+1)! - n! → n! * n
 * - (n+1)! + n! → n! * (n + 2)
 */
export function simplifyFactorialAdd(x: Expression): RuleStep | undefined {
  if (x.operator !== 'Add' || !isFunction(x)) return undefined;

  const ops = x.ops;
  if (ops.length < 2) return undefined;

  // Extract factorial info from each operand
  const factTerms: Array<{
    coeff: number;
    factArg: Expression;
    index: number;
  }> = [];

  for (let i = 0; i < ops.length; i++) {
    const info = extractFactorialTerm(ops[i]);
    if (info) factTerms.push({ ...info, index: i });
  }

  // Need at least 2 factorial terms
  if (factTerms.length < 2) return undefined;

  const ce = x.engine;

  // Get base+offset for each factorial argument
  const bos = factTerms.map((f) => ({ ...f, bo: baseOffset(f.factArg) }));
  const validBOs = bos.filter((b) => b.bo !== null);

  if (validBOs.length < 2) return undefined;

  // Check if all share the same symbolic base
  const refBase = validBOs[0].bo!.base;
  if (!validBOs.every((b) => b.bo!.base.isSame(refBase))) return undefined;

  // Find the minimum offset (smallest factorial)
  let minOffset = Infinity;
  for (const b of validBOs) {
    if (b.bo!.offset < minOffset) minOffset = b.bo!.offset;
  }

  // Find the argument expression for the minimum factorial
  const minFactArg = validBOs.find((v) => v.bo!.offset === minOffset)!.factArg;

  // Build the inner terms: for each factorial, compute the partial product
  const innerTerms: Expression[] = [];

  for (const b of validBOs) {
    const d = b.bo!.offset - minOffset;

    if (d === 0) {
      // This term IS the minimum factorial
      innerTerms.push(ce.number(b.coeff));
    } else if (d > 0 && d <= 8) {
      // Build product (minArg+1)(minArg+2)...(minArg+d)
      let product: Expression = minFactArg.add(ce.One);
      for (let i = 2; i <= d; i++) {
        product = product.mul(minFactArg.add(ce.number(i)));
      }
      if (b.coeff === 1) {
        innerTerms.push(product);
      } else if (b.coeff === -1) {
        innerTerms.push(product.neg());
      } else {
        innerTerms.push(ce.number(b.coeff).mul(product));
      }
    } else {
      // Difference too large or negative (shouldn't happen since we found min)
      return undefined;
    }
  }

  // Sum the inner terms
  const innerSum =
    innerTerms.length === 1
      ? innerTerms[0]
      : ce.function('Add', innerTerms);

  // Result: Factorial(minFactArg) * innerSum
  // Use _fn to avoid canonicalization that might re-distribute the product
  const factorialExpr = ce._fn('Factorial', [minFactArg]);
  const factored = ce._fn('Multiply', [factorialExpr, innerSum]);

  // Include any non-factorial terms from the original Add
  const factIndices = new Set(factTerms.map((f) => f.index));
  const nonFactTerms = ops.filter((_, i) => !factIndices.has(i));

  if (nonFactTerms.length > 0)
    return {
      value: ce._fn('Add', [factored, ...nonFactTerms]),
      because: 'factor common factorial',
    };

  return { value: factored, because: 'factor common factorial' };
}

/**
 * Simplification rules for the Gamma function.
 *
 * Patterns:
 * - Gamma(n+1) → n! (when n is a non-negative integer or symbol declared integer)
 * - Gamma(1) → 1
 * - Gamma(n) → (n-1)! (when n is a positive integer)
 */
export function simplifyGamma(x: Expression): RuleStep | undefined {
  if (x.operator !== 'Gamma' || !isFunction(x)) return undefined;

  const arg = x.op1;
  if (!arg) return undefined;

  const ce = x.engine;

  // Gamma(1) → 1
  if (arg.is(1)) return { value: ce.One, because: 'Gamma(1) -> 1' };

  // Gamma(n) for concrete positive integer n: Gamma(n) = (n-1)!
  if (isNumber(arg) && arg.isInteger && arg.isPositive) {
    const n = arg.re;
    if (n >= 1 && n <= 170) {
      return {
        value: ce._fn('Factorial', [ce.number(n - 1)]),
        because: 'Gamma(n) -> (n-1)!',
      };
    }
  }

  // Gamma(n+1) → n! for symbolic integer n
  const bo = baseOffset(arg);
  if (bo && bo.offset === 1 && !isNumber(bo.base)) {
    // Check if base is declared as integer/non-negative
    if (isSymbol(bo.base) && bo.base.isInteger) {
      return {
        value: ce._fn('Factorial', [bo.base]),
        because: 'Gamma(n+1) -> n!',
      };
    }
  }

  // Gamma(n) → (n-1)! for symbolic positive integer n
  if (bo && bo.offset === 0 && !isNumber(bo.base)) {
    if (isSymbol(bo.base) && bo.base.isInteger && bo.base.isPositive) {
      return {
        value: ce._fn('Factorial', [bo.base.sub(ce.One)]),
        because: 'Gamma(n) -> (n-1)!',
      };
    }
  }

  return undefined;
}

/**
 * Simplification rules for Factorial2 (double factorial).
 *
 * Patterns:
 * - n!! / k!! → partial product (concrete integers, same parity)
 * - (2n)!! → 2^n * n! (symbolic identity)
 * - 0!! → 1
 * - 1!! → 1
 * - (-1)!! → 1
 */
export function simplifyFactorial2(x: Expression): RuleStep | undefined {
  if (x.operator !== 'Factorial2' || !isFunction(x)) return undefined;

  const arg = x.op1;
  if (!arg) return undefined;

  const ce = x.engine;

  // 0!! → 1
  if (arg.is(0)) return { value: ce.One, because: '0!! -> 1' };

  // 1!! → 1
  if (arg.is(1)) return { value: ce.One, because: '1!! -> 1' };

  // (-1)!! → 1
  if (arg.is(-1)) return { value: ce.One, because: '(-1)!! -> 1' };

  // (2n)!! → 2^n * n! when arg = Multiply(2, n) and n is a symbol
  if (arg.operator === 'Multiply' && isFunction(arg) && arg.ops.length === 2) {
    const [a, b] = arg.ops;
    let n: Expression | null = null;
    if (isNumber(a) && a.is(2) && !isNumber(b)) n = b;
    if (isNumber(b) && b.is(2) && !isNumber(a)) n = a;
    if (n && isSymbol(n) && n.isInteger) {
      return {
        value: ce._fn('Multiply', [
          ce._fn('Power', [ce.number(2), n]),
          ce._fn('Factorial', [n]),
        ]),
        because: '(2n)!! -> 2^n * n!',
      };
    }
  }

  return undefined;
}

/**
 * Simplification for Factorial2 (double factorial) division.
 *
 * Patterns:
 * - n!! / k!! → partial product (concrete integers, same parity)
 */
export function simplifyFactorial2Divide(x: Expression): RuleStep | undefined {
  if (x.operator !== 'Divide' || !isFunction(x)) return undefined;

  const num = x.op1;
  const denom = x.op2;
  if (!num || !denom) return undefined;

  if (
    num.operator !== 'Factorial2' ||
    denom.operator !== 'Factorial2' ||
    !isFunction(num) ||
    !isFunction(denom)
  )
    return undefined;

  const a = num.op1;
  const b = denom.op1;

  const ce = x.engine;

  // Concrete integer case: compute partial product
  if (
    isNumber(a) &&
    isNumber(b) &&
    a.isInteger &&
    b.isInteger &&
    a.isNonNegative &&
    b.isNonNegative
  ) {
    const aVal = a.re;
    const bVal = b.re;

    // Must have same parity
    if ((aVal % 2) !== (bVal % 2)) return undefined;

    if (aVal >= bVal) {
      // n!!/k!! = (k+2)(k+4)...n (step by 2)
      let result = 1n;
      for (let i = BigInt(bVal) + 2n; i <= BigInt(aVal); i += 2n)
        result *= i;
      return {
        value: ce.number(result),
        because: 'n!!/k!! partial product',
      };
    } else {
      // n < k: n!!/k!! = 1/((n+2)(n+4)...k)
      let result = 1n;
      for (let i = BigInt(aVal) + 2n; i <= BigInt(bVal); i += 2n)
        result *= i;
      return {
        value: ce.number([1, result]),
        because: 'n!!/k!! -> 1/(partial product)',
      };
    }
  }

  return undefined;
}

/**
 * Check if an Add expression's operands relate to a factorial argument
 * via baseOffset. Used to narrow the Multiply skip condition.
 */
export function addRelatesToFactorial(
  addExpr: Expression,
  factArg: Expression
): boolean {
  const factBO = baseOffset(factArg);
  if (!factBO) return false;

  // Check if the Add expression shares the same symbolic base
  const addBO = baseOffset(addExpr);
  if (addBO && addBO.base.isSame(factBO.base)) return true;

  // Also check if any operand of the Add shares the base
  if (isFunction(addExpr) && addExpr.ops) {
    for (const op of addExpr.ops) {
      if (op.isSame(factBO.base)) return true;
      const opBO = baseOffset(op);
      if (opBO && opBO.base.isSame(factBO.base)) return true;
    }
  }

  return false;
}
