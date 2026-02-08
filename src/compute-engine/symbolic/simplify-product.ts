import type { BoxedExpression, RuleStep } from '../global-types';

/**
 * Product simplification rules extracted from simplify-rules.ts.
 * Handles 13 patterns for simplifying Product expressions.
 */
export function simplifyProduct(x: BoxedExpression): RuleStep | undefined {
  if (x.operator !== 'Product') return undefined;

  const body = x.op1;
  const limits = x.op2;
  if (!body || !limits || limits.operator !== 'Limits') return undefined;

  const index = limits.op1?.symbol;
  const lower = limits.op2;
  const upper = limits.op3;
  if (!index || !lower || !upper) return undefined;

  const ce = x.engine;

  // Simplify nested Sum/Product in the body first
  if (body.operator === 'Sum' || body.operator === 'Product') {
    const simplifiedBody = body.simplify();
    if (!simplifiedBody.isSame(body)) {
      const newProduct = ce.function('Product', [simplifiedBody, limits]);
      return { value: newProduct, because: 'simplified nested sum/product' };
    }
  }

  // Handle numeric bounds edge cases
  if (lower.isNumberLiteral && upper.isNumberLiteral) {
    const lowerVal = lower.numericValue;
    const upperVal = upper.numericValue;
    if (
      typeof lowerVal === 'number' &&
      typeof upperVal === 'number' &&
      Number.isInteger(lowerVal) &&
      Number.isInteger(upperVal)
    ) {
      // Empty range: upper < lower → return 1 (identity for multiplication)
      if (upperVal < lowerVal) {
        return { value: ce.One, because: 'empty product' };
      }
      // Single iteration: upper == lower → substitute and return body
      if (upperVal === lowerVal) {
        return {
          value: body.subs({ [index]: lower }).simplify(),
          because: 'single term product',
        };
      }
    }
  }

  const bodyUnknowns = new Set(body.unknowns);

  // If body doesn't depend on index: Product(c, [n, a, b]) → c^(b - a + 1)
  if (!bodyUnknowns.has(index)) {
    const count = upper.sub(lower).add(ce.One).simplify();
    // Check for empty range with symbolic bounds
    if (count.isNumberLiteral && count.numericValue !== null) {
      const countVal =
        typeof count.numericValue === 'number'
          ? count.numericValue
          : count.numericValue.re;
      if (countVal <= 0) {
        return { value: ce.One, because: 'empty product' };
      }
    }
    return {
      value: body.simplify().pow(count),
      because: 'product of constant',
    };
  }

  // If body is just the index: Product(n, [n, 1, b]) → b!
  if (body.symbol === index && lower.is(1)) {
    return {
      value: ce.function('Factorial', [upper]),
      because: 'factorial',
    };
  }

  // Product with index shift: Product(n+c, [n, 1, b]) → (b+c)!/c!
  // Pattern: Add with index and constant
  if (body.operator === 'Add' && body.ops?.length === 2 && lower.is(1)) {
    const [op1, op2] = body.ops;
    let indexTerm: BoxedExpression | null = null;
    let constTerm: BoxedExpression | null = null;

    if (op1.symbol === index && !new Set(op2.unknowns).has(index)) {
      indexTerm = op1;
      constTerm = op2;
    } else if (op2.symbol === index && !new Set(op1.unknowns).has(index)) {
      indexTerm = op2;
      constTerm = op1;
    }

    if (indexTerm && constTerm) {
      // Product(n+c, [n, 1, b]) = (b+c)! / c!
      const b = upper;
      const c = constTerm;
      const result = ce.function('Divide', [
        ce.function('Factorial', [ce.function('Add', [b, c])]),
        ce.function('Factorial', [c]),
      ]);
      return { value: result, because: 'shifted factorial' };
    }
  }

  // Telescoping product: Product((k+1)/k, [k, 1, n]) → n+1
  if (body.operator === 'Divide' && lower.is(1)) {
    const num = body.op1;
    const denom = body.op2;
    // Check for (k+1)/k pattern
    if (
      denom?.symbol === index &&
      num?.operator === 'Add' &&
      num.ops?.length === 2 &&
      num.ops.some((o) => o.symbol === index) &&
      num.ops.some((o) => o.is(1))
    ) {
      // Result is n + 1
      return { value: upper.add(ce.One), because: 'telescoping product' };
    }
  }

  // Product(1 - 1/k^2, [k, 2, n]) → (n+1)/(2n)
  // Canonical form is: Add(1, Negate(Power(k, -2))) = 1 + (-k^(-2))
  if (body.operator === 'Add' && body.ops?.length === 2 && lower.is(2)) {
    let hasOne = false;
    let hasNegInvSq = false;

    for (const op of body.ops) {
      if (op.is(1)) {
        hasOne = true;
      } else if (
        op.operator === 'Negate' &&
        op.op1?.operator === 'Power' &&
        op.op1.op1?.symbol === index &&
        op.op1.op2?.is(-2)
      ) {
        hasNegInvSq = true;
      } else if (
        op.operator === 'Power' &&
        op.op1?.symbol === index &&
        op.op2?.is(-2)
      ) {
        // Could also be -k^(-2) represented as Power with negative coefficient
        // Check if it's negated via Multiply
      } else if (
        op.operator === 'Multiply' &&
        op.ops?.some((o) => o.is(-1)) &&
        op.ops?.some(
          (o) =>
            o.operator === 'Power' && o.op1?.symbol === index && o.op2?.is(-2)
        )
      ) {
        hasNegInvSq = true;
      }
    }

    if (hasOne && hasNegInvSq) {
      // (n+1)/(2n)
      const n = upper;
      const result = ce.function('Divide', [
        ce.function('Add', [n, ce.One]),
        ce.function('Multiply', [ce.number(2), n]),
      ]);
      return { value: result, because: 'Wallis-like product' };
    }
  }

  // Double factorial (odd): Product(2n-1, [n, 1, b]) → (2b-1)!!
  if (body.operator === 'Add' && body.ops?.length === 2 && lower.is(1)) {
    let hasLinearTerm = false;
    let coefficient = 0;
    let constantTerm = 0;

    for (const op of body.ops) {
      if (op.isNumberLiteral && typeof op.numericValue === 'number') {
        constantTerm = op.numericValue;
      } else if (op.operator === 'Multiply' && op.ops?.length === 2) {
        const [a, b] = op.ops;
        if (
          a.isNumberLiteral &&
          typeof a.numericValue === 'number' &&
          b.symbol === index
        ) {
          coefficient = a.numericValue;
          hasLinearTerm = true;
        } else if (
          b.isNumberLiteral &&
          typeof b.numericValue === 'number' &&
          a.symbol === index
        ) {
          coefficient = b.numericValue;
          hasLinearTerm = true;
        }
      }
    }

    // Product(2n-1, [n, 1, b]) → (2b-1)!!
    if (hasLinearTerm && coefficient === 2 && constantTerm === -1) {
      const b = upper;
      const result = ce.function('Factorial2', [
        ce.function('Subtract', [
          ce.function('Multiply', [ce.number(2), b]),
          ce.One,
        ]),
      ]);
      return { value: result, because: 'odd double factorial' };
    }

    // Product(2n+1, [n, 0, b]) → (2b+1)!! (starting from 0)
    // This gives 1 * 3 * 5 * ... * (2b+1) = (2b+1)!!
  }

  // Double factorial (even): Product(2n, [n, 1, b]) → 2^b * b!
  if (body.operator === 'Multiply' && body.ops?.length === 2 && lower.is(1)) {
    const [op1, op2] = body.ops;
    // Check for 2 * n or n * 2 pattern
    if (
      (op1.is(2) && op2.symbol === index) ||
      (op2.is(2) && op1.symbol === index)
    ) {
      const b = upper;
      const result = ce.function('Multiply', [
        ce.function('Power', [ce.number(2), b]),
        ce.function('Factorial', [b]),
      ]);
      return { value: result, because: 'even double factorial' };
    }
  }

  // Rising factorial (Pochhammer): Product(x+k, [k, 0, n-1]) → Pochhammer(x, n)
  // Pattern: body is Add with x (constant wrt index) and index
  if (body.operator === 'Add' && body.ops?.length === 2 && lower.is(0)) {
    let base: BoxedExpression | null = null;
    let hasIndex = false;

    for (const op of body.ops) {
      if (op.symbol === index) {
        hasIndex = true;
      } else if (!new Set(op.unknowns).has(index)) {
        base = op;
      }
    }

    // Check if upper bound is n-1 form (i.e., there's an n such that upper = n - 1)
    if (hasIndex && base) {
      const n = upper.add(ce.One).simplify();
      const result = ce.function('Pochhammer', [base, n]);
      return { value: result, because: 'rising factorial (Pochhammer)' };
    }
  }

  // Falling factorial: Product(x-k, [k, 0, n-1]) → x! / (x-n)!
  // Pattern: body is Subtract or Add with negative index
  if (lower.is(0)) {
    let base: BoxedExpression | null = null;
    let hasNegIndex = false;

    if (body.operator === 'Subtract' && body.ops?.length === 2) {
      const [op1, op2] = body.ops;
      if (op2.symbol === index && !new Set(op1.unknowns).has(index)) {
        base = op1;
        hasNegIndex = true;
      }
    } else if (body.operator === 'Add' && body.ops?.length === 2) {
      // Check for x + (-k) form
      for (const op of body.ops) {
        if (op.operator === 'Negate' && op.op1?.symbol === index) {
          hasNegIndex = true;
        } else if (!new Set(op.unknowns).has(index)) {
          base = op;
        }
      }
    }

    if (hasNegIndex && base) {
      const n = upper.add(ce.One).simplify();
      // x! / (x-n)!
      const result = ce.function('Divide', [
        ce.function('Factorial', [base]),
        ce.function('Factorial', [base.sub(n)]),
      ]);
      return { value: result, because: 'falling factorial' };
    }
  }

  // Factor out constants: Product(c * f(n), [n, a, b]) → c^(b-a+1) * Product(f(n), [n, a, b])
  if (body.operator === 'Multiply' && body.ops) {
    const constantFactors: BoxedExpression[] = [];
    const indexFactors: BoxedExpression[] = [];

    for (const factor of body.ops) {
      const factorUnknowns = new Set(factor.unknowns);
      if (factorUnknowns.has(index)) {
        indexFactors.push(factor);
      } else {
        constantFactors.push(factor);
      }
    }

    // Only factor out if there are both constant and index-dependent factors
    if (constantFactors.length > 0 && indexFactors.length > 0) {
      const constant =
        constantFactors.length === 1
          ? constantFactors[0]
          : ce.function('Multiply', constantFactors);
      const indexPart =
        indexFactors.length === 1
          ? indexFactors[0]
          : ce.function('Multiply', indexFactors);
      const count = upper.sub(lower).add(ce.One).simplify();
      const newProduct = ce.function('Product', [indexPart, limits]);
      return {
        value: constant.pow(count).mul(newProduct),
        because: 'factor out constant from product',
      };
    }
  }

  return undefined;
}
