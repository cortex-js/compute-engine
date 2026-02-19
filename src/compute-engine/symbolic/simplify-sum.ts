import type { Expression, RuleStep } from '../global-types';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards';

/**
 * Sum simplification rules extracted from simplify-rules.ts.
 * Handles 16 patterns for simplifying Sum expressions.
 */
export function simplifySum(x: Expression): RuleStep | undefined {
  if (!isFunction(x, 'Sum')) return undefined;

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
      const newSum = ce.function('Sum', [simplifiedBody, limits]);
      return { value: newSum, because: 'simplified nested sum/product' };
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
      // Empty range: upper < lower → return 0 (identity for addition)
      if (upperVal < lowerVal) {
        return { value: ce.Zero, because: 'empty sum' };
      }
      // Single iteration: upper == lower → substitute and return body
      if (upperVal === lowerVal) {
        return {
          value: body.subs({ [index]: lower }).simplify(),
          because: 'single term sum',
        };
      }
    }
  }

  const bodyUnknowns = new Set(body.unknowns);

  // If body doesn't depend on index: Sum(c, [n, a, b]) → (b - a + 1) * c
  if (!bodyUnknowns.has(index)) {
    const count = upper.sub(lower).add(ce.One).simplify();
    // Check for empty range with symbolic bounds
    if (isNumber(count) && count.numericValue !== undefined) {
      const countVal =
        typeof count.numericValue === 'number'
          ? count.numericValue
          : count.numericValue.re;
      if (countVal <= 0) {
        return { value: ce.Zero, because: 'empty sum' };
      }
    }
    return {
      value: count.mul(body.simplify()),
      because: 'sum of constant',
    };
  }

  // If body is just the index: Sum(n, [n, a, b]) → (b(b+1) - (a-1)a) / 2
  if (sym(body) === index) {
    // General formula: sum from a to b = sum from 1 to b - sum from 1 to (a-1)
    // = b(b+1)/2 - (a-1)a/2 = (b(b+1) - a(a-1)) / 2
    const a = lower;
    const b = upper;
    const result = b
      .mul(b.add(ce.One))
      .sub(a.mul(a.sub(ce.One)))
      .div(2);
    return { value: result.simplify(), because: 'triangular number' };
  }

  // If body is index squared: Sum(n^2, [n, 1, b]) → b(b+1)(2b+1)/6
  if (
    isFunction(body, 'Power') &&
    sym(body.op1) === index &&
    body.op2.isSame(2) &&
    lower.isSame(1)
  ) {
    // Sum of squares formula: b(b+1)(2b+1)/6
    // Note: Don't simplify() here as the expanded form is more expensive
    const b = upper;
    const result = b.mul(b.add(ce.One)).mul(b.mul(2).add(ce.One)).div(6);
    return { value: result, because: 'sum of squares' };
  }

  // If body is index cubed: Sum(n^3, [n, 1, b]) → [b(b+1)/2]^2
  if (
    isFunction(body, 'Power') &&
    sym(body.op1) === index &&
    body.op2.isSame(3) &&
    lower.isSame(1)
  ) {
    // Sum of cubes formula: [b(b+1)/2]^2 = b^2(b+1)^2/4
    const b = upper;
    const triangular = b.mul(b.add(ce.One)).div(2);
    return { value: triangular.pow(2), because: 'sum of cubes' };
  }

  // Note: Sum of fourth powers and fifth powers formulas are not included
  // because their closed-form expressions are more expensive than the Sum
  // expression itself (cost ratio > 1.2), so they don't pass the simplify
  // cost threshold. They can still be evaluated numerically.

  // Alternating unit series: Sum((-1)^n, [n, 0, b]) → (1 + (-1)^b) / 2
  if (
    isFunction(body, 'Power') &&
    body.op1.isSame(-1) &&
    sym(body.op2) === index &&
    lower.isSame(0)
  ) {
    const b = upper;
    // (1 + (-1)^b) / 2 = 1 if b even, 0 if b odd
    const result = ce.One.add(ce.number(-1).pow(b)).div(2);
    return { value: result, because: 'alternating unit series' };
  }

  // Alternating linear series: Sum((-1)^n * n, [n, 0, b]) → (-1)^b * floor((b+1)/2)
  if (isFunction(body, 'Multiply') && lower.isSame(0)) {
    // Check for (-1)^n * n pattern
    let hasAlternating = false;
    let hasIndex = false;
    for (const op of body.ops) {
      if (
        isFunction(op, 'Power') &&
        op.op1.isSame(-1) &&
        sym(op.op2) === index
      ) {
        hasAlternating = true;
      } else if (sym(op) === index) {
        hasIndex = true;
      }
    }
    if (hasAlternating && hasIndex && body.ops.length === 2) {
      const b = upper;
      // (-1)^b * floor((b+1)/2)
      const result = ce.function('Multiply', [
        ce.function('Power', [ce.number(-1), b]),
        ce.function('Floor', [
          ce.function('Divide', [
            ce.function('Add', [b, ce.One]),
            ce.number(2),
          ]),
        ]),
      ]);
      return { value: result, because: 'alternating linear series' };
    }
  }

  // Arithmetic progression: Sum(a + d*n, [n, 0, b]) → (b+1)*a + d*b*(b+1)/2
  // Detect pattern: Add with constant and index-linear term
  if (isFunction(body, 'Add')) {
    let constant: Expression | null = null;
    let coefficient: Expression | null = null;

    for (const term of body.ops) {
      const termUnknowns = new Set(term.unknowns);
      if (!termUnknowns.has(index)) {
        // Constant term
        constant = constant ? constant.add(term) : term;
      } else if (sym(term) === index) {
        // Just the index variable (coefficient = 1)
        coefficient = coefficient ? coefficient.add(ce.One) : ce.One;
      } else if (
        isFunction(term, 'Multiply') &&
        term.ops.some((op) => sym(op) === index)
      ) {
        // c * n form - extract coefficient
        const coef = term.ops.filter((op) => sym(op) !== index);
        if (coef.length === term.ops.length - 1) {
          const c = coef.length === 1 ? coef[0] : ce.function('Multiply', coef);
          coefficient = coefficient ? coefficient.add(c) : c;
        }
      } else {
        // More complex term - can't simplify as arithmetic progression
        constant = null;
        coefficient = null;
        break;
      }
    }

    if (constant !== null && coefficient !== null) {
      // General arithmetic progression: Sum(a + d*n, [n, m, b])
      // = (b - m + 1) * (a + d*(m + b)/2)
      // = number of terms * average value
      const m = lower;
      const b = upper;

      if (lower.isSame(0)) {
        // Simpler case: Sum from n=0 to b of (a + d*n) = (b+1)*(a + d*b/2)
        const bPlus1 = ce.function('Add', [b, ce.One]);
        const inner = ce.function('Add', [
          constant,
          ce.function('Divide', [
            ce.function('Multiply', [coefficient, b]),
            ce.number(2),
          ]),
        ]);
        const result = ce.function('Multiply', [bPlus1, inner]);
        return { value: result, because: 'arithmetic progression' };
      } else {
        // General case: Sum from n=m to b of (a + d*n) = (b-m+1)*(a + d*(m+b)/2)
        const numTerms = ce.function('Add', [
          ce.function('Subtract', [b, m]),
          ce.One,
        ]);
        const avgIndex = ce.function('Divide', [
          ce.function('Add', [m, b]),
          ce.number(2),
        ]);
        const avgValue = ce.function('Add', [
          constant,
          ce.function('Multiply', [coefficient, avgIndex]),
        ]);
        const result = ce.function('Multiply', [numTerms, avgValue]);
        return { value: result, because: 'arithmetic progression' };
      }
    }
  }

  // Geometric series: Sum(r^n, [n, 0, b]) → (1 - r^(b+1)) / (1 - r)
  // Also handles: Sum(r^n, [n, 1, b]) → r * (1 - r^b) / (1 - r)
  if (
    isFunction(body, 'Power') &&
    sym(body.op2) === index &&
    !new Set(body.op1.unknowns).has(index)
  ) {
    const r = body.op1;
    const b = upper;

    if (lower.isSame(0)) {
      // Sum from n=0 to b of r^n = (1 - r^(b+1)) / (1 - r)
      const numerator = ce.One.sub(r.pow(b.add(ce.One)));
      const denominator = ce.One.sub(r);
      return { value: numerator.div(denominator), because: 'geometric series' };
    } else if (lower.isSame(1)) {
      // Sum from n=1 to b of r^n = (r - r^(b+1)) / (1 - r)
      // Note: This form is more compact than r*(1-r^b)/(1-r)
      const numerator = r.sub(r.pow(b.add(ce.One)));
      const denominator = ce.One.sub(r);
      return { value: numerator.div(denominator), because: 'geometric series' };
    }
  }

  // Sum of binomial coefficients: Sum(C(n,k), [k, 0, n]) → 2^n
  if (
    isFunction(body, 'Binomial') &&
    lower.isSame(0) &&
    sym(body.op2) === index
  ) {
    const n = body.op1;
    // Check if upper bound equals n (the first argument of Binomial)
    if (n && upper.isSame(n)) {
      const result = ce.function('Power', [ce.number(2), n]);
      return { value: result, because: 'sum of binomial coefficients' };
    }
  }

  // Alternating binomial sum: Sum((-1)^k * C(n,k), [k, 0, n]) → 0 (for n > 0)
  // Pattern: Multiply with (-1)^k and Binomial(n, k)
  if (isFunction(body, 'Multiply') && lower.isSame(0)) {
    let hasBinomial = false;
    let hasAlternating = false;
    let binomialN: Expression | null = null;

    for (const op of body.ops) {
      if (isFunction(op, 'Binomial') && sym(op.op2) === index) {
        hasBinomial = true;
        binomialN = op.op1 ?? null;
      } else if (
        isFunction(op, 'Power') &&
        op.op1.isSame(-1) &&
        sym(op.op2) === index
      ) {
        hasAlternating = true;
      }
    }

    if (hasBinomial && hasAlternating && binomialN && upper.isSame(binomialN)) {
      // For n > 0: sum = 0, for n = 0: sum = 1
      // We return 0 for the general case; numeric evaluation handles n=0
      return { value: ce.Zero, because: 'alternating binomial sum' };
    }

    // Weighted binomial sum: Sum(k * C(n,k), [k, 0, n]) → n * 2^(n-1)
    let hasIndex = false;
    binomialN = null;
    hasBinomial = false;

    for (const op of body.ops) {
      if (sym(op) === index) {
        hasIndex = true;
      } else if (isFunction(op, 'Binomial') && sym(op.op2) === index) {
        hasBinomial = true;
        binomialN = op.op1 ?? null;
      }
    }

    if (
      hasIndex &&
      hasBinomial &&
      binomialN &&
      upper.isSame(binomialN) &&
      body.ops.length === 2
    ) {
      // n * 2^(n-1)
      const n = binomialN;
      const result = ce.function('Multiply', [
        n,
        ce.function('Power', [ce.number(2), n.sub(ce.One)]),
      ]);
      return { value: result, because: 'weighted binomial sum' };
    }

    // Weighted squared binomial sum: Sum(k^2 * C(n,k), [k, 0, n]) → n(n+1) * 2^(n-2)
    let hasIndexSquared = false;
    binomialN = null;
    hasBinomial = false;

    for (const op of body.ops) {
      if (
        isFunction(op, 'Power') &&
        sym(op.op1) === index &&
        op.op2.isSame(2)
      ) {
        hasIndexSquared = true;
      } else if (isFunction(op, 'Binomial') && sym(op.op2) === index) {
        hasBinomial = true;
        binomialN = op.op1 ?? null;
      }
    }

    if (
      hasIndexSquared &&
      hasBinomial &&
      binomialN &&
      upper.isSame(binomialN) &&
      body.ops.length === 2
    ) {
      // n(n+1) * 2^(n-2)
      const n = binomialN;
      const result = ce.function('Multiply', [
        n,
        n.add(ce.One),
        ce.function('Power', [ce.number(2), n.sub(ce.number(2))]),
      ]);
      return { value: result, because: 'weighted squared binomial sum' };
    }

    // Weighted cubed binomial sum: Sum(k^3 * C(n,k), [k, 0, n]) → n²(n+3) * 2^(n-3)
    let hasIndexCubed = false;
    binomialN = null;
    hasBinomial = false;

    for (const op of body.ops) {
      if (
        isFunction(op, 'Power') &&
        sym(op.op1) === index &&
        op.op2.isSame(3)
      ) {
        hasIndexCubed = true;
      } else if (isFunction(op, 'Binomial') && sym(op.op2) === index) {
        hasBinomial = true;
        binomialN = op.op1 ?? null;
      }
    }

    if (
      hasIndexCubed &&
      hasBinomial &&
      binomialN &&
      upper.isSame(binomialN) &&
      body.ops.length === 2
    ) {
      // n²(n+3) * 2^(n-3)
      const n = binomialN;
      const result = ce.function('Multiply', [
        ce.function('Power', [n, ce.number(2)]),
        n.add(ce.number(3)),
        ce.function('Power', [ce.number(2), n.sub(ce.number(3))]),
      ]);
      return { value: result, because: 'weighted cubed binomial sum' };
    }

    // Alternating weighted binomial: Sum((-1)^k * k * C(n,k), [k, 0, n]) → 0 for n >= 2
    let hasAltTerm = false;
    let hasIndexTerm = false;
    binomialN = null;
    hasBinomial = false;

    for (const op of body.ops) {
      if (
        isFunction(op, 'Power') &&
        op.op1.isSame(-1) &&
        sym(op.op2) === index
      ) {
        hasAltTerm = true;
      } else if (sym(op) === index) {
        hasIndexTerm = true;
      } else if (isFunction(op, 'Binomial') && sym(op.op2) === index) {
        hasBinomial = true;
        binomialN = op.op1 ?? null;
      }
    }

    if (
      hasAltTerm &&
      hasIndexTerm &&
      hasBinomial &&
      binomialN &&
      upper.isSame(binomialN) &&
      body.ops.length === 3
    ) {
      // For n >= 2, sum = 0
      return { value: ce.Zero, because: 'alternating weighted binomial sum' };
    }
  }

  // Sum of binomial coefficient squares: Sum(C(n,k)^2, [k, 0, n]) → C(2n, n)
  if (
    isFunction(body, 'Power') &&
    body.op1.operator === 'Binomial' &&
    isFunction(body.op1) &&
    body.op2.isSame(2) &&
    lower.isSame(0)
  ) {
    const binomial = body.op1;
    const n = binomial.op1;
    const k = binomial.op2;
    if (n && sym(k) === index && upper.isSame(n)) {
      // C(2n, n)
      const result = ce.function('Binomial', [
        ce.function('Multiply', [ce.number(2), n]),
        n,
      ]);
      return { value: result, because: 'sum of binomial squares' };
    }
  }

  // Sum of k*(k+1): Sum(k*(k+1), [k, 1, n]) → n(n+1)(n+2)/3
  if (
    isFunction(body, 'Multiply') &&
    body.ops.length === 2 &&
    lower.isSame(1)
  ) {
    const [op1, op2] = body.ops;
    // Check for k * (k+1) pattern
    const isKTimesKPlus1 =
      (sym(op1) === index &&
        op2.operator === 'Add' &&
        isFunction(op2) &&
        op2.ops.length === 2 &&
        op2.ops.some((o) => sym(o) === index) &&
        op2.ops.some((o) => o.isSame(1))) ||
      (sym(op2) === index &&
        op1.operator === 'Add' &&
        isFunction(op1) &&
        op1.ops.length === 2 &&
        op1.ops.some((o) => sym(o) === index) &&
        op1.ops.some((o) => o.isSame(1)));

    if (isKTimesKPlus1) {
      // n(n+1)(n+2)/3
      const n = upper;
      const result = ce.function('Divide', [
        ce.function('Multiply', [
          n,
          ce.function('Add', [n, ce.One]),
          ce.function('Add', [n, ce.number(2)]),
        ]),
        ce.number(3),
      ]);
      return { value: result, because: 'sum of k*(k+1)' };
    }
  }

  // Partial fractions / telescoping: Sum(1/(k*(k+1)), [k, 1, n]) → n/(n+1)
  // Pattern: Divide with 1 over Multiply(k, k+1) or k*(k-1)
  if (
    isFunction(body, 'Divide') &&
    body.op1.isSame(1) &&
    body.op2.operator === 'Multiply' &&
    isFunction(body.op2)
  ) {
    const denom = body.op2;
    if (denom.ops.length === 2) {
      const [d1, d2] = denom.ops;
      // Check for k * (k+1) pattern with lower=1
      if (lower.isSame(1)) {
        const isKTimesKPlus1 =
          (sym(d1) === index &&
            d2.operator === 'Add' &&
            isFunction(d2) &&
            d2.ops.length === 2 &&
            d2.ops.some((op) => sym(op) === index) &&
            d2.ops.some((op) => op.isSame(1))) ||
          (sym(d2) === index &&
            d1.operator === 'Add' &&
            isFunction(d1) &&
            d1.ops.length === 2 &&
            d1.ops.some((op) => sym(op) === index) &&
            d1.ops.some((op) => op.isSame(1)));

        if (isKTimesKPlus1) {
          // n / (n + 1)
          const n = upper;
          const result = n.div(n.add(ce.One));
          return { value: result, because: 'partial fractions (telescoping)' };
        }
      }

      // Check for k * (k-1) pattern with lower=2: Sum(1/(k*(k-1)), [k, 2, n]) → (n-1)/n
      if (lower.isSame(2)) {
        const isKTimesKMinus1 =
          (sym(d1) === index &&
            d2.operator === 'Add' &&
            isFunction(d2) &&
            d2.ops.length === 2 &&
            d2.ops.some((op) => sym(op) === index) &&
            d2.ops.some((op) => op.isSame(-1))) ||
          (sym(d2) === index &&
            d1.operator === 'Add' &&
            isFunction(d1) &&
            d1.ops.length === 2 &&
            d1.ops.some((op) => sym(op) === index) &&
            d1.ops.some((op) => op.isSame(-1)));

        if (isKTimesKMinus1) {
          // (n - 1) / n
          const n = upper;
          const result = n.sub(ce.One).div(n);
          return {
            value: result,
            because: 'partial fractions (telescoping k*(k-1))',
          };
        }
      }
    }
  }

  // Factor out constants: Sum(c * f(n), [n, a, b]) → c * Sum(f(n), [n, a, b])
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
      const newSum = ce.function('Sum', [indexPart, limits]);
      return {
        value: constant.mul(newSum),
        because: 'factor out constant from sum',
      };
    }
  }

  return undefined;
}
