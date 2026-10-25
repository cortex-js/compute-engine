import type {
  IComputeEngine as ComputeEngine,
  Expression,
} from '../global-types.js';

import { isRelationalOperator } from '../latex-syntax/utils.js';
import { checkDeadline } from '../../common/interruptible.js';
import { isContinuationOperand, isFunction, isNumber } from './type-guards.js';

import { asSmallInteger } from './numerics.js';
import { mul, expandProducts } from './arithmetic-mul-div.js';
import { add } from './arithmetic-add.js';
import { mayBeMatrixValued, typeMayHoldNumber } from './matrix-operand.js';
import { containsResidueClass, residueFoldOrKeep } from './residue-class.js';

const binomials = [
  [1],
  [1, 1],
  [1, 2, 1],
  [1, 3, 3, 1],
  [1, 4, 6, 4, 1],
  [1, 5, 10, 10, 5, 1],
  [1, 6, 15, 20, 15, 6, 1],
  [1, 7, 21, 35, 35, 21, 7, 1],
  [1, 8, 28, 56, 70, 56, 28, 8, 1],
];

export function choose(n: number, k: number): number {
  while (n >= binomials.length) {
    const s = binomials.length;
    const nextRow = [1];
    const prev = binomials[s - 1];
    for (let i = 1; i < s; i++) nextRow[i] = prev[i - 1] + prev[i];

    nextRow[s] = 1;
    binomials.push(nextRow);
  }
  return binomials[n][k];
}

function multinomialCoefficient(k: number[]): bigint {
  let n = k.reduce((acc, v) => acc + v, 0);
  let prod = BigInt(1);
  for (let i = 0; i < k.length; i += 1) {
    // Every division in this binomial recurrence is exact. A machine-number
    // Pascal table rounds large coefficients before symbolic cancellation.
    const m = Math.min(k[i], n - k[i]);
    let binomial = BigInt(1);
    for (let j = 1; j <= m; j++)
      binomial = (binomial * BigInt(n - m + j)) / BigInt(j);
    prod *= binomial;
    n -= k[i];
  }
  return prod;
}

// Return all the combinations of n non-negative integers that sum to exp.
function* powers(n: number, exp: number): Generator<number[]> {
  if (n === 1) {
    yield [exp];
    return;
  }

  for (let i = 0; i <= exp; i += 1)
    for (const p of powers(n - 1, exp - i)) yield [i, ...p];
}

/**
 * Is `x` a float literal, such as `1.0` or `2.0`? A power with a float
 * exponent is not expanded as an integer power: the expansion would drop the
 * float (`x^{1.0}` would become `x`, `x^{0.0}` the exact `1`, and
 * `(a+b)^{2.0}` would have exact coefficients). A float operand makes a
 * numeric result a float.
 */
function isFloatLiteral(x: Expression): boolean {
  return isNumber(x) && !x.isExact;
}

/**
 * Can the term `x` of a sum be a matrix with two axes? This is the case for
 * a `Matrix` literal, an operand whose type admits a matrix
 * (`typeMayHoldMatrix()`: `matrix`, `tensor<number>`, `any`, ...), and a
 * product, a power or a negation of such an operand. A vector or a list of
 * numbers is not (its product is element-wise, so it commutes), nor is a
 * number or an operand of unknown type.
 */
function mayBeMatrixTerm(x: Expression): boolean {
  if (mayBeMatrixValued(x)) return true;
  if (isFunction(x, 'Negate')) return mayBeMatrixTerm(x.op1);
  if (isFunction(x, 'Multiply')) return x.ops.some(mayBeMatrixTerm);
  if (isFunction(x, 'Power')) return mayBeMatrixTerm(x.op1);
  return false;
}

/**
 * The most terms that the ordered expansion of a power of a sum of matrices
 * produces (the sum has `n` terms, the power `k`: `n^k` terms before the like
 * terms are combined). A power with more terms is left as it is: the
 * expansion of `(A + B)^8` has 256 terms, that of `(A + B + C)^8` 6561.
 */
const MAX_ORDERED_EXPANSION_TERMS = 1024;

/** Use the multinomial theorem (https://en.wikipedia.org/wiki/Multinomial_theorem) to expand the expression.
 * The expression must be a power of a sum of terms.
 * The power must be a positive integer.
 * - expr = '(a + b)^2'
 *     ->  'a^2 + 2ab + b^2'
 * - expr = '(a + b)^3'
 *    -> 'a^3 + 3a^2b + 3ab^2 + b^3'
 */

function expandPower(base: Expression, exp: number): Expression | null {
  const ce = base.engine;
  if (exp < 0) {
    const expr = expandPower(base, -exp);
    return expr ? expr.inv() : null;
  }
  if (exp === 0) return ce.One;
  if (exp === 1) return expand(base);
  if (isFunction(base, 'Negate')) {
    if (Number.isInteger(exp)) {
      const sign = exp % 2 === 0 ? 1 : -1;
      const result = expandPower(base.op1, exp);
      if (result === null) return null;
      return sign > 0 ? result : result.neg();
    }
  }

  // Subtract is non-canonical, so we don't expect to see it here.
  console.assert(base.operator !== 'Subtract');

  // We can expand only if the expression is a power of a sum.
  if (!isFunction(base, 'Add')) return null;

  // Terms that may be matrices do not commute: the product of two matrices
  // is the matrix product. The multinomial theorem below assumes that they
  // do (`(p + q)^2` is not `p^2 + 2p·q + q^2`), so the power is expanded as
  // a product of `exp` copies of the sum, in order: `(p + q)^2` is
  // `p^2 + p·q + q·p + q^2`. Vectors and lists of numbers are not matrices:
  // their product is element-wise and commutes.
  //
  // A sum in which a term may be a matrix and another may be a number
  // (`A + x`, `A + B` with `B: any`) is not expanded: the sum of a matrix and
  // a number adds the number to every entry, so `(A + x)^2` is not
  // `A^2 + 2xA + x^2`. Every term must be a matrix by its type. A power with
  // more than `MAX_ORDERED_EXPANSION_TERMS` terms is not expanded either.
  const matrixTerms = base.ops.filter(mayBeMatrixTerm).length;
  if (matrixTerms >= 1) {
    if (
      matrixTerms < 2 ||
      !base.ops.every((t) => mayBeMatrixTerm(t) && !typeMayHoldNumber(t))
    )
      return null;
    if (base.ops.length ** exp > MAX_ORDERED_EXPANSION_TERMS) return null;
    const deadline = ce._deadline;
    let result: Expression = base;
    for (let i = 1; i < exp; i += 1) {
      checkDeadline(deadline);
      result = expandProducts(ce, [result, base]) ?? result;
    }
    return result;
  }

  // Apply the multinomial theorem
  // https://en.wikipedia.org/wiki/Multinomial_theorem
  // (a + b + c)^n = sum_{k1 + k2 + ... + km = n} (n choose k1, k2, ..., km) a^k1 b^k2 ... c^km
  // where the sum is over all non-negative integers k1, k2, ..., km such that k1 + k2 + ... + km = n
  // and (n choose k1, k2, ..., km) = n! / (k1! k2! ... km!)
  // For example, (a + b)^3 = (a + b)^2 (a + b) = (a^2 + 2ab + b^2) (a + b) = a^3 + 3a^2b + 3ab^2 + b^3
  // The multinomial theorem is a generalization of the binomial theorem.
  // For example, (a + b)^2 = a^2 + 2ab + b^2
  // (a + b + c)^2 = (a + b + c) (a + b + c) = a^2 + b^2 + c^2 + 2ab + 2ac + 2bc
  // (a + b + c)^3 = (a + b + c) (a + b + c) (a + b + c) = a^3 + b^3 + c^3 + 3a^2b + 3a^2c + 3b^2a + 3b^2c + 3c^2a + 3c^2b + 6abc

  const terms = base.ops;
  const it = powers(terms.length, exp);

  const result: Expression[] = [];
  const deadline = ce._deadline;
  let count = 0;
  for (const val of it) {
    // A high power of a sum enumerates a multinomial with `C(exp+m-1, m-1)`
    // terms — e.g. `(a+b+c)^350` is ~6·10⁴ — so this loop can run for many
    // seconds. Checkpoint the engine deadline (stride-amortized) so a runaway
    // expansion honors the `withTimeLimit` span instead of stalling (e.g.
    // the compiler's symbolic-antiderivative attempt on `(trinomial)^p`).
    if ((++count & 0xff) === 0) checkDeadline(deadline);
    const product = [ce.number(multinomialCoefficient(val))];
    for (let i = 0; i < val.length; i += 1) {
      if (val[i] !== 0) {
        if (val[i] === 1) product.push(terms[i]);
        else product.push(terms[i].pow(val[i]));
      }
    }
    result.push(mul(...product));
  }
  return add(...result);
}

/** Attempt to transform the expression (h, ops) into a sum */
export function expandFunction(
  ce: ComputeEngine,
  h: string,
  ops: ReadonlyArray<Expression>
): Expression | null {
  // See `expand()`: an expression with a residue class is not expanded.
  if (ops.some(containsResidueClass)) return null;
  let result: Expression | null = null;

  //
  // Divide
  //
  if (h === 'Divide') {
    const num = expand(ops[0]);
    if (isFunction(num, 'Add'))
      return add(...num.ops.map((x) => x.div(ops[1])));
    return ce._fn('Divide', [num, ops[1]]);
  }

  //
  // Multiply
  //
  if (h === 'Multiply') {
    // First expand Power operands (e.g., (x+h)^2 -> x^2+2xh+h^2)
    // so that expandProducts can distribute the coefficient.
    // Only expand Power-of-Add, not other operands, to avoid
    // losing Add structure (e.g., Add(x, sqrt(2)*x) -> x*(1+sqrt(2)))
    const expandedOps = ops.map((op) => {
      if (
        isFunction(op, 'Power') &&
        isFunction(op.op1) &&
        op.op1.operator === 'Add' &&
        !isFloatLiteral(op.op2)
      ) {
        const exp = asSmallInteger(op.op2);
        if (exp !== null && exp >= 2) return expandPower(op.op1, exp) ?? op;
      }
      return op;
    });
    return expandProducts(ce, expandedOps);
  }

  //
  // Negate
  //
  if (h === 'Negate') return expand(ops[0]).neg();

  //
  //
  // Add
  //

  if (h === 'Add') return add(...ops.map((x) => expand(x)));

  //
  // Power
  //
  if (h === 'Power') {
    const exp = asSmallInteger(ops[1]);
    result =
      exp !== null && !isFloatLiteral(ops[1]) ? expandPower(ops[0], exp) : null;
    // A number-literal base has no structural expansion, but "expanding" a
    // constant power still computes it — Expand((2+3i)^1000) yields the exact
    // Gaussian integer, matching SymPy's expand(). The evaluation is the
    // exact power fold, already guarded against huge results
    // (MAX_EXACT_POW_DIGITS); if it stays symbolic, the power is returned
    // unchanged.
    if (result === null && exp !== null && isNumber(ops[0]))
      result = ce._fn('Power', [ops[0], ops[1]]).evaluate();
  }

  return result;
}

/** Apply the distributive law if the expression is a product of sums.
 * For example, a(b + c) = ab + ac
 * Expand the expression if it is a power of a sum.
 * Expand the terms of the expression if it is a sum or negate.
 * If the expression is a fraction, expand the numerator.
 * If the exression is a relational operator, expand the operands.
 * Return null if the expression cannot be expanded.
 */
export function expand(expr: Expression): Expression {
  // To expand an expression, we need to use its canonical form
  expr = expr.canonical;

  if (typeof expr.operator !== 'string') return expr;

  // An expression with a residue class is not expanded: the distribution
  // and the cancellations of an expansion do not know the ring of the class
  // (`(c·(x + 1))/c` is not `x + 1` when `c` has no inverse). A closed
  // expression is folded by the residue rules instead
  // (`residueFoldOrKeep()`).
  if (containsResidueClass(expr)) return residueFoldOrKeep(expr);

  // A sum or product with a direct `ContinuationPlaceholder` operand
  // (`2 · 4 · … · 2n`) is a notational object, not an arithmetic one, and so
  // is its negation: the expansion would fold the samples across the
  // ellipsis (`−(2 · 4 · … · 2n)` became `−16 · … · n` under `simplify()`,
  // CE-163). It is left as it is, as by the other fold barriers.
  const notational = (e: Expression): boolean =>
    isFunction(e) && e.ops.some((x) => isContinuationOperand(x));
  if (notational(expr) || (isFunction(expr, 'Negate') && notational(expr.op1)))
    return expr;

  //
  // Expand relational operators
  //
  if (isRelationalOperator(expr.operator)) {
    const ops = isFunction(expr) ? expr.ops : [];
    return expr.engine._fn(
      expr.operator,
      ops.map((x) => expand(x))
    );
  }

  return (
    expandFunction(
      expr.engine,
      expr.operator,
      isFunction(expr) ? expr.ops : []
    ) ?? expr
  );
}

/**
 * Recursive expand of all terms in the expression.
 *
 * `expand()` only expands the top level of the expression.
 */
export function expandAll(expr: Expression): Expression {
  if (!expr.operator || !isFunction(expr)) return expr;

  const ops = expr.ops.map((x) => expandAll(x));

  // No operand expanded: reuse the node instead of re-canonicalizing it.
  if (ops.every((x, i) => x === expr.ops[i])) return expand(expr);
  return expand(expr.engine.function(expr.operator, ops));
}
