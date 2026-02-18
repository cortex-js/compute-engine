import type { Expression, RuleStep } from '../global-types';
import { isFunction, isNumber } from '../boxed-expression/type-guards';

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

  if (isFunction(expr, 'Add') && expr.nops === 2) {
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
  if (nBO && kBO && nBO.base.isSame(kBO.base) && nBO.offset - kBO.offset === 1)
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
  if (isFunction(term, 'Factorial')) return { coeff: 1, factArg: term.op1 };

  // Negate(Factorial(n))
  if (
    isFunction(term, 'Negate') &&
    term.op1.operator === 'Factorial' &&
    isFunction(term.op1)
  )
    return { coeff: -1, factArg: term.op1.op1 };

  // Multiply with integer coefficient and Factorial
  if (isFunction(term, 'Multiply')) {
    const ops = term.ops;
    let factIdx = -1;
    for (let i = 0; i < ops.length; i++) {
      if (isFunction(ops[i], 'Factorial')) {
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
  if (!isFunction(x, 'Add')) return undefined;

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
    innerTerms.length === 1 ? innerTerms[0] : ce.function('Add', innerTerms);

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
