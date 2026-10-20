import type { Expression, RuleStep } from '../global-types.js';
import { isFunction, isNumber, sym } from '../boxed-expression/type-guards.js';
import { infiniteRange, keepInfiniteRangeStep } from './simplify-sum.js';
import { isTransitivelyPure } from '../boxed-expression/transitive-purity.js';

/**
 * The value of `Product(c, …)` over a range with infinitely many terms, for
 * a body `c` that does not depend on the index: the limit of `cⁿ`. It is 1
 * for `c = 1`, 0 for `|c| < 1` and +∞ for `c > 1`. Otherwise undefined: for
 * `c ≤ −1` the partial products do not converge, and for a body whose value
 * is not known (`Π_{k≥1} y`) the limit depends on that value, so the product
 * stays as it is. `y^(+∞)` is not a value. Does not call `simplify()`: it
 * runs inside a simplification rule, and `Product.evaluate()` also uses it.
 *
 * The comparisons with ±1 use no tolerance, since the limit jumps there:
 * `1.000000000001ⁿ` grows to +∞, and `0.999999999999ⁿ` goes to 0. An exact
 * number is compared exactly. A float, or a closed expression that is not
 * a number literal (`e^(10^(−20))`), is compared through its numeric value,
 * and a value within the engine tolerance of ±1 is declined: the float does
 * not tell on which side of ±1 the exact value is. A body with free symbols
 * is decided only by what is known about them (`p > 2` gives +∞).
 *
 * An impure body (a random draw, a call with effects) is declined before
 * any comparison: it is not the same value in each factor, and a comparison
 * could evaluate it and run its effects.
 */
export function constantProductOverInfiniteRange(
  body: Expression
): Expression | undefined {
  const ce = body.engine;
  if (!isTransitivelyPure(body)) return undefined;
  if (body.isSame(1)) return ce.One;
  if (isNumber(body) && body.isExact) {
    if (body.isGreater(1) === true) return ce.PositiveInfinity;
    if (body.isLess(1) === true && body.isGreater(-1) === true) return ce.Zero;
    return undefined;
  }
  if (body.unknowns.length > 0) {
    if (body.isGreater(1) === true) return ce.PositiveInfinity;
    if (body.isLess(1) === true && body.isGreater(-1) === true) return ce.Zero;
    return undefined;
  }
  const value = body.N();
  if (!isNumber(value) || value.im !== 0) return undefined;
  const c = value.re;
  if (!Number.isFinite(c)) return undefined;
  const tolerance = ce.tolerance;
  if (Math.abs(c - 1) <= tolerance || Math.abs(c + 1) <= tolerance)
    return undefined;
  if (c > 1) return ce.PositiveInfinity;
  if (c > -1 && c < 1) return ce.Zero;
  return undefined;
}

/**
 * Simplify a `Product`. A range with infinitely many terms is read through
 * `infiniteRange()`: a body that does not depend on the index is handled by
 * `constantProductOverInfiniteRange()`, and the steps of the other rules are
 * checked by `keepInfiniteRangeStep()`.
 */
export function simplifyProduct(x: Expression): RuleStep | undefined {
  if (!isFunction(x, 'Product')) return undefined;
  const range = infiniteRange(x);
  if (range && !range.body.symbols.includes(range.index)) {
    const value = constantProductOverInfiniteRange(range.body);
    if (value === undefined) return undefined;
    return {
      value,
      because: 'infinite product of a constant',
      purpose: 'transform',
    };
  }
  const step = simplifyProductRules(x);
  if (step === undefined || range === undefined) return step;
  return keepInfiniteRangeStep(range, step) ? step : undefined;
}

/**
 * Product simplification rules extracted from simplify-rules.ts.
 * Handles 13 patterns for simplifying Product expressions.
 */
function simplifyProductRules(x: Expression): RuleStep | undefined {
  if (!isFunction(x, 'Product')) return undefined;
  // The rules below read only the first indexing clause, and the products
  // they build keep only that clause. With more than one clause
  // (`Product(j, Limits(i, 1, 3), Limits(j, 1, n))`), the other indexes
  // would be read as free symbols and their clauses lost (that product gave
  // `j^3`), so the product stays as it is.
  if (x.nops > 2) return undefined;

  const body = x.op1;
  const limits = x.op2;
  if (!body || !isFunction(limits, 'Limits')) return undefined;

  const index = sym(limits.op1);
  let lower = limits.op2;
  let upper = limits.op3;
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

  // A `Nothing` bound is an absent bound, not a value. With no bounds
  // (`\prod_k f`, `Limits(k, Nothing, Nothing)`) the product runs over
  // `k = 1..+∞`, so the rules below read the bounds 1 and +∞, as
  // `evaluate()` and `N()` do (`withDefaultBigOpBounds()` in
  // `library/utils.ts`). A product the rules rebuild keeps the clause with
  // no bounds. With one bound only (`\prod_{k=1} f`) the product has no
  // value, so it stays as it is.
  const noLower = sym(lower) === 'Nothing';
  const noUpper = sym(upper) === 'Nothing';
  if (noLower !== noUpper) return undefined;
  if (noLower && noUpper) {
    // A clause with no index and no bounds has no index to run over.
    if (index === 'Nothing') return undefined;
    lower = ce.One;
    upper = ce.PositiveInfinity;
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

  // For a symbolic upper bound `b`, the closed forms below are the generic
  // answer, as in Mathematica: they fire without a proof that `b ≥ a − 1`.
  // They equal the finite product for `b ≥ a − 1`; below that they give the
  // continuation of the closed form, not the empty product 1 (user decision
  // 2026-10-19). A numeric empty range is handled above.
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
      // Cost-gate exempt: resolving a Product into a closed form is
      // preferred whatever the two sides score.
      return {
        value: result,
        because: 'shifted factorial',
        purpose: 'transform',
      };
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

  // Product(1 - 1/k^2, [k, a, n]) → (a-1)(n+1)/(a·n), for a positive integer
  // lower bound a (each factor is the product of the telescoping ratios
  // (k-1)/k and (k+1)/k; the evaluate route, `symbolicProductClosedForm` in
  // `library/utils.ts`, gives the same form for any spelling of the body).
  // Both bounds must be safe integers when they are numbers: the
  // empty-range check above handles only those, and the closed form of an
  // empty range is 1, not the formula.
  // Canonical form is: Add(1, Negate(Power(k, -2))) = 1 + (-k^(-2))
  if (
    isFunction(body, 'Add') &&
    body.ops.length === 2 &&
    lower.isInteger === true &&
    Number.isSafeInteger(lower.re) &&
    lower.re >= 1 &&
    (!isNumber(upper) ||
      upper.isInfinity === true ||
      Number.isSafeInteger(upper.re))
  ) {
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
      // (a-1)(n+1)/(a·n); for an infinite upper bound its limit, (a-1)/a,
      // directly: substituting `n = +∞` into the finite form gives `∞/∞`.
      const n = upper;
      // From a = 1 the first factor is 0.
      if (lower.isSame(1))
        return { value: ce.Zero, because: 'Wallis-like product' };
      const aMinusOne = lower.sub(ce.One);
      if (n.isInfinity === true && n.isPositive === true)
        return {
          value: ce.function('Divide', [aMinusOne, lower]),
          because: 'Wallis-like product',
        };
      const result = ce.function('Divide', [
        ce.function('Multiply', [aMinusOne, ce.function('Add', [n, ce.One])]),
        ce.function('Multiply', [lower, n]),
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
      // Cost-gate exempt: see the note on 'shifted factorial' above.
      return {
        value: result,
        because: 'falling factorial',
        purpose: 'transform',
      };
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
