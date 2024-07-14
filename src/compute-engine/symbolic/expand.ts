import { asMachineInteger } from '../boxed-expression/numerics';
import { isRelationalOperator } from '../boxed-expression/utils';
import { simplifyAdd } from '../library/arithmetic-add';
import { BoxedExpression, IComputeEngine } from '../public';

function expandProduct(
  lhs: Readonly<BoxedExpression>,
  rhs: Readonly<BoxedExpression>
): BoxedExpression {
  //
  // Negate
  //

  if (lhs.head === 'Negate' && rhs.head === 'Negate')
    return expandProduct(lhs.op1, rhs.op1);

  const ce = lhs.engine;

  if (lhs.head === 'Negate')
    return ce.evalMul(ce.NegativeOne, expandProduct(lhs.op1, rhs));
  if (rhs.head === 'Negate')
    return ce.evalMul(ce.NegativeOne, expandProduct(lhs, rhs.op1));

  //
  // Divide
  //
  if (lhs.head === 'Divide' && rhs.head === 'Divide') {
    // Apply distribute to the numerators only.
    const denom = ce.evalMul(lhs.op2, rhs.op2);
    return ce.div(expandProduct(lhs.op1, rhs.op1), denom);
  }

  if (lhs.head === 'Divide')
    return ce.div(expandProduct(lhs.op1, rhs), lhs.op2);
  if (rhs.head === 'Divide')
    return ce.div(expandProduct(lhs, rhs.op1), rhs.op2);

  //
  // Add
  //
  if (lhs.head === 'Add')
    return ce.add(...lhs.ops!.map((x) => expandProduct(x, rhs)));
  if (rhs.head === 'Add')
    return ce.add(...rhs.ops!.map((x) => expandProduct(lhs, x)));

  //
  // Something else...
  //
  return ce.evalMul(lhs, rhs);
}

export function expandProducts(
  ce: IComputeEngine,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression | null {
  if (ops.length === 0) return null;
  if (ops.length === 1) return ops[0];
  if (ops.length === 2) return expandProduct(ops[0], ops[1]);

  const rhs = expandProducts(ce, ops.slice(1));
  if (!rhs) return null;
  return expandProduct(ops[0], rhs);
}

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

function multinomialCoefficient(k: number[]): number {
  let n = k.reduce((acc, v) => acc + v, 0);
  let prod = 1;
  for (let i = 0; i < k.length; i += 1) {
    prod *= choose(n, k[i]);
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

/** Use the multinomial theorem (https://en.wikipedia.org/wiki/Multinomial_theorem) to expand the expression.
 * The expression must be a power of a sum of terms.
 * The power must be a positive integer.
 * - expr = '(a + b)^2'
 *     ->  'a^2 + 2ab + b^2'
 * - expr = '(a + b)^3'
 *    -> 'a^3 + 3a^2b + 3ab^2 + b^3'
 */

function expandPower(
  base: BoxedExpression,
  exp: number
): BoxedExpression | null {
  const ce = base.engine;
  if (exp < 0) {
    const expr = expandPower(base, -exp);
    return expr ? expr.inv() : null;
  }
  if (exp === 0) return ce.One;
  if (exp === 1) return expand(base);
  if (base.head === 'Negate') {
    if (Number.isInteger(exp)) {
      const sign = exp % 2 === 0 ? 1 : -1;
      const result = expandPower(base.op1, exp);
      if (result === null) return null;
      return sign > 0 ? result : result.neg();
    }
  }

  // Subtract is non-canonical, so we don't expect to see it here.
  console.assert(base.head !== 'Subtract');

  // We can expand only if the expression is a power of a sum.
  if (base.head !== 'Add') return null;

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

  const terms = base.ops!;
  const it = powers(terms.length, exp);

  const result: BoxedExpression[] = [];
  for (const val of it) {
    const product = [ce.number(multinomialCoefficient(val))];
    for (let i = 0; i < val.length; i += 1) {
      if (val[i] !== 0) {
        if (val[i] === 1) product.push(terms[i]);
        else product.push(terms[i].pow(val[i]));
      }
    }
    result.push(ce.evalMul(...product));
  }
  return ce.add(...result);
}

/** ExpandNumerator
 * Expand the numerator of a fraction, or a simple product
 */

function expandNumerator(expr: BoxedExpression): BoxedExpression | null {
  if (expr.head !== 'Divide') return null;
  const expandedNumerator = expand(expr.op1);
  if (expandedNumerator === null) return null;
  const ce = expr.engine;
  if (expandedNumerator.head === 'Add') {
    return ce.add(...expandedNumerator.ops!.map((x) => ce.div(x, expr.op2)));
  }
  return expr.engine.div(expandedNumerator, expr.op2);
}

/** ExpandDenominator
 * Expand the denominator of a fraction (but not a simple product)
 */

function expandDenominator(expr: BoxedExpression): BoxedExpression | null {
  if (expr.head !== 'Divide') return null;
  const expandedDenominator = expand(expr.op2);
  if (expandedDenominator === null) return null;
  const ce = expr.engine;
  if (expandedDenominator.head === 'Add') {
    return ce.add(...expandedDenominator.ops!.map((x) => ce.div(expr.op1, x)));
  }
  return ce.div(expr.op1, expandedDenominator);
}

/** Attempt to transform the expression (h, ops) into a sum */
export function expandFunction(
  ce: IComputeEngine,
  h: string,
  ops: ReadonlyArray<BoxedExpression>
): BoxedExpression | null {
  let result: BoxedExpression | null = null;

  //
  // Divide
  //
  if (h === 'Divide') {
    const num = expand(ops[0]);
    if (!num) return null;
    if (num?.head === 'Add')
      result = ce.add(...num.ops!.map((x) => ce.div(x, ops[1])));
    else result = ce._fn('Divide', [num, ops[1]]);
  }

  //
  // Multiply
  //
  if (h === 'Multiply') result = expandProducts(ce, ops);

  //
  // Negate
  //
  if (h === 'Negate') {
    result = expand(ops[0]);
    return result ? result.neg() : null;
  }

  //
  //
  // Add
  //

  if (h === 'Add')
    return simplifyAdd(
      ce,
      ops.map((x) => expand(x) ?? x)
    );

  //
  // Power
  //
  if (h === 'Power') {
    const exp = asMachineInteger(ops[1]);
    result = exp !== null ? expandPower(ops[0], exp) : null;
  }

  // Simplify the sum
  if (result && result.head === 'Add')
    result = simplifyAdd(
      ce,
      result.ops!.map((x) => x.simplify())
    );

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
export function expand(
  expr: BoxedExpression | undefined
): BoxedExpression | null {
  if (!expr || typeof expr.head !== 'string') return null;

  //
  // Expand relational operators
  //
  if (isRelationalOperator(expr.head)) {
    return expr.engine._fn(
      expr.head,
      expr.ops!.map((x) => expand(x) ?? x)
    );
  }

  return expandFunction(expr.engine, expr.head, expr.ops ?? []);
}

/**
 * Recursive expand of all terms in the expression.
 *
 * `expand()` only expands the top level of the expression.
 */
export function expandAll(expr: BoxedExpression): BoxedExpression | null {
  if (!expr.head || !expr.ops) return null;

  const ce = expr.engine;
  const ops = expr.ops.map((x) =>
    typeof x.head === 'string' && x.ops
      ? expandFunction(ce, x.head, x.ops) ?? x
      : x
  );

  const result = expr.engine.function(expr.head, ops);
  return expand(result) ?? result;
}
