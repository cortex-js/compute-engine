import type { Expression, RuleStep } from '../global-types';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards';

/**
 * Product simplification rules extracted from simplify-rules.ts.
 * Handles 13 patterns for simplifying Product expressions.
 */
export function simplifyProduct(x: Expression): RuleStep | undefined {
  if (!isFunction(x, 'Product')) return undefined;

  const body = x.op1;
  const limits = x.op2;
  if (!body || !isFunction(limits, 'Limits')) return undefined;

  const index = sym(limits.op1);
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
  if (isNumber(lower) && isNumber(upper)) {
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
    if (isNumber(count) && count.numericValue !== undefined) {
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
  if (sym(body) === index && lower.isSame(1)) {
    return {
      value: ce.function('Factorial', [upper]),
      because: 'factorial',
    };
  }

  // Product with index shift: Product(n+c, [n, 1, b]) → (b+c)!/c!
  // Pattern: Add with index and constant
  if (isFunction(body, 'Add') && body.ops.length === 2 && lower.isSame(1)) {
    const [op1, op2] = body.ops;
    let indexTerm: Expression | null = null;
    let constTerm: Expression | null = null;

    if (sym(op1) === index && !new Set(op2.unknowns).has(index)) {
      indexTerm = op1;
      constTerm = op2;
    } else if (sym(op2) === index && !new Set(op1.unknowns).has(index)) {
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
  if (isFunction(body, 'Divide') && lower.isSame(1)) {
    const num = body.op1;
    const denom = body.op2;
    // Check for (k+1)/k pattern
    if (
      sym(denom) === index &&
      num.operator === 'Add' &&
      isFunction(num) &&
      num.ops.length === 2 &&
      num.ops.some((o) => sym(o) === index) &&
      num.ops.some((o) => o.isSame(1))
    ) {
      // Result is n + 1
      return { value: upper.add(ce.One), because: 'telescoping product' };
    }
  }

  // Product(1 - 1/k^2, [k, 2, n]) → (n+1)/(2n)
  // Canonical form is: Add(1, Negate(Power(k, -2))) = 1 + (-k^(-2))
  if (isFunction(body, 'Add') && body.ops.length === 2 && lower.isSame(2)) {
    let hasOne = false;
    let hasNegInvSq = false;

    for (const op of body.ops) {
      if (op.isSame(1)) {
        hasOne = true;
      } else if (
        isFunction(op, 'Negate') &&
        op.op1.operator === 'Power' &&
        isFunction(op.op1) &&
        sym(op.op1.op1) === index &&
        op.op1.op2.isSame(-2)
      ) {
        hasNegInvSq = true;
      } else if (
        isFunction(op, 'Power') &&
        sym(op.op1) === index &&
        op.op2.isSame(-2)
      ) {
        // Could also be -k^(-2) represented as Power with negative coefficient
        // Check if it's negated via Multiply
      } else if (
        isFunction(op, 'Multiply') &&
        op.ops.some((o) => o.isSame(-1)) &&
        op.ops.some(
          (o) =>
            isFunction(o, 'Power') && sym(o.op1) === index && o.op2.isSame(-2)
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
  if (isFunction(body, 'Add') && body.ops.length === 2 && lower.isSame(1)) {
    let hasLinearTerm = false;
    let coefficient = 0;
    let constantTerm = 0;

    for (const op of body.ops) {
      if (isNumber(op) && typeof op.numericValue === 'number') {
        constantTerm = op.numericValue;
      } else if (isFunction(op, 'Multiply') && op.ops.length === 2) {
        const [a, b] = op.ops;
        if (
          isNumber(a) &&
          typeof a.numericValue === 'number' &&
          sym(b) === index
        ) {
          coefficient = a.numericValue;
          hasLinearTerm = true;
        } else if (
          isNumber(b) &&
          typeof b.numericValue === 'number' &&
          sym(a) === index
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
  if (
    isFunction(body, 'Multiply') &&
    body.ops.length === 2 &&
    lower.isSame(1)
  ) {
    const [op1, op2] = body.ops;
    // Check for 2 * n or n * 2 pattern
    if (
      (op1.isSame(2) && sym(op2) === index) ||
      (op2.isSame(2) && sym(op1) === index)
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
  if (isFunction(body, 'Add') && body.ops.length === 2 && lower.isSame(0)) {
    let base: Expression | null = null;
    let hasIndex = false;

    for (const op of body.ops) {
      if (sym(op) === index) {
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
  if (lower.isSame(0)) {
    let base: Expression | null = null;
    let hasNegIndex = false;

    if (isFunction(body, 'Subtract') && body.ops.length === 2) {
      const [op1, op2] = body.ops;
      if (sym(op2) === index && !new Set(op1.unknowns).has(index)) {
        base = op1;
        hasNegIndex = true;
      }
    } else if (isFunction(body, 'Add') && body.ops.length === 2) {
      // Check for x + (-k) form
      for (const op of body.ops) {
        if (isFunction(op, 'Negate') && sym(op.op1) === index) {
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
  if (isFunction(body, 'Multiply')) {
    const constantFactors: Expression[] = [];
    const indexFactors: Expression[] = [];

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
