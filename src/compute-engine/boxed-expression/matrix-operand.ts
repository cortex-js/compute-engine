import type { Expression } from '../global-types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { isSymbol } from './type-guards.js';

/**
 * Can this operand be a matrix, although its type does not say so? This is
 * `true` when the type of the operand is not known to exclude a collection:
 * the type is `unknown` or `any` (the call `g(x)` of a function that was not
 * declared), a union such as `number | matrix`, or a collection that is not
 * known to be a matrix or a vector (`g(A)` with `A` a matrix has the type
 * `matrix<unknown^(2x2)>`). A tuple is not a matrix. An operand of a scalar
 * type (`number`, `real`, `integer`) is `false`.
 *
 * A symbol of type `unknown` (a symbol with no declaration and no value) is
 * `false`: a symbol used in a product is a number. `ce.box(['Multiply', 'A',
 * 'x'])` infers the type `number` for `x`, but `ce.parse('A x')` leaves it
 * `unknown`, and the two must give the same product. A symbol declared with
 * the type `any` is not inferred to be a number, so it is `true`.
 *
 * In a product with a matrix, such an operand must not move past a matrix
 * or past another operand of this kind: if it is a matrix, the two factors
 * do not commute. A nested product that is not canonical yet is spliced
 * into the outer product before its operands are made canonical (see
 * `flattenRawProductOperands()` in `canonical-numeric.ts`), so that
 * `['Multiply', 'A', ['Multiply', ['g', 'x'], ['k', 'x'], ['g', 'x']]]`
 * keeps the written order `A·g(x)·k(x)·g(x)`.
 *
 * A negative integer power of such an operand stays a `Power`
 * (`canonicalPower()` in `arithmetic-power.ts`): it is the matrix inverse
 * when the operand is a matrix.
 *
 * This function is in its own file because `arithmetic-power.ts` and
 * `order.ts` both use it, and `order.ts` imports `arithmetic-power.ts`.
 */
export function mayBeTensorProductOperand(x: Expression): boolean {
  const facts = x.type.facts;
  if (facts.collection === false || facts.tupleShaped) return false;
  return !(isSymbol(x) && x.type.type === 'unknown');
}

/**
 * Can the base `x` of a power be a matrix, although its type does not say
 * so? This is `mayBeTensorProductOperand()` (the call `g(x)` of a function
 * that was not declared, an operand of type `any`, a union with a
 * collection), except for a list of numbers (`[1, 2, 3]`, a symbol declared
 * `vector<3>` or `list<number>`): it has one dimension, so it is not a
 * matrix, and its power is element-wise.
 *
 * A negative integer power of such a base is the matrix inverse (or a power
 * of it) when the base is a matrix. So it stays a `Power`: it is not made
 * canonical as a quotient (`canonicalPower()`), it is not moved to the
 * denominator of a product (`Product` in `arithmetic-mul-div.ts`), and it is
 * not written as a fraction (`serialize.ts` and the LaTeX serializer). The
 * quotient `1/g(x)` is the element-wise reciprocal of a matrix.
 */
export function mayBeMatrixPowerBase(x: Expression): boolean {
  return (
    mayBeTensorProductOperand(x) &&
    !x.type.matches(new BoxedType('list<number>'))
  );
}

/**
 * Can a product with the canonical factors `xs` have a matrix factor? This
 * is `true` when a factor can be a matrix (`mayBeTensorProductOperand()`: a
 * matrix, a collection, the call `g(x)` of a function that was not
 * declared) and every factor is valid.
 *
 * A nested product is spliced into the outer product before it is sorted
 * only when this is `true`: then the outer product keeps the order of the
 * factors that can be matrices. Otherwise the order of the factors does not
 * matter, and the nested product is made canonical on its own, as it was
 * before. A product with an invalid factor is not sorted at all, so a splice
 * would change its form.
 */
export function productMayHaveMatrix(xs: ReadonlyArray<Expression>): boolean {
  return xs.every((x) => x.isValid) && xs.some(mayBeTensorProductOperand);
}
